import * as CANNON from 'cannon-es';
import { MECH, WEAPONS } from '../shared/constants.js';

// The mech: one heavy dynamic torso that hovers on stiff invisible legs.
// HUGE and SLOW on purpose — wind-ups, thundering steps, deliberate turns.
// Limbs are visual (client) except where they hit things, which resolves
// here on the server against a list of targets the game mode provides.

const UP = new CANNON.Vec3(0, 1, 0);

export class Mech {
  constructor(world, id, spawnPos, color, facingYaw = 0) {
    this.world = world;
    this.id = id;
    this.color = color;
    this.spawn = new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z);

    const s = MECH.torsoSize;
    this.body = new CANNON.Body({
      mass: MECH.torsoMass,
      shape: new CANNON.Box(new CANNON.Vec3(s.x / 2, s.y / 2, s.z / 2)),
      position: this.spawn.clone(),
      linearDamping: 0.25,
      angularDamping: 0.6,
    });
    this.body.allowSleep = false;
    this.body.quaternion.setFromEuler(0, facingYaw, 0);
    world.addBody(this.body);

    this.input = {
      move: { x: 0, z: 0 },
      legsYaw: facingYaw,   // LEGS player's camera — their WASD frame
      headYaw: facingYaw,   // HEAD player's aim — body slowly turns to match
      headPitch: 0,
      armYawL: facingYaw, armPitchL: 0,
      armYawR: facingYaw, armPitchR: 0,
      punchL: false, punchR: false,
      kick: false,
      dash: false,
      fire: false,       // HEAD laser
      spin: false,       // ARMS rotary cannon (hold)
      launch: false,     // HEAD rocket pods (press)
    };

    this.hp = MECH.maxHp;
    this.maxHp = MECH.maxHp;
    this.upgrades = { dmg: 0, armor: 0, speed: 0, laser: 0, rocket: false, turret: false, dash: false, cannon: false, pods: false };
    this.dashCd = 0;
    this.turretCd = 0;
    this.prevDash = false;

    this.grounded = false;
    this.ragdollT = 0;
    this.tiltT = 0;
    this.invulnT = 1.0;   // brief mercy after getting up
    this.walkSpeed = 0;
    this.stepAccum = 0;   // distance since last THUD
    this.stepSide = 0;

    // Attack state machines
    this.arms = {
      L: { phase: 'idle', t: 0 },
      R: { phase: 'idle', t: 0 },
    };
    this.kick = { phase: 'idle', t: 0 };
    this.laser = { charge: 0, firing: false, fireT: 0, from: null, to: null };
    this.rockets = []; // flying fists: { side, p, v, t }
    this.cannonSpin = 0;      // 0..1 spin-up
    this.cannonCd = 0;
    this.tracers = [];        // { p, v, t }
    this.podAmmo = 0;         // filled when 'pods' upgrade owned
    this.podRegen = 0;
    this.missiles = [];       // { p, v, t, target }
    this.prevLaunch = false;

    this.stats = { damageDealt: 0, punches: 0, kicks: 0, lasers: 0, falls: 0, byPart: { ARMS: 0, LEGS: 0, HEAD: 0, TURRET: 0 } };
    this.events = [];
  }

  get isRagdoll() { return this.ragdollT > 0; }
  get isDead() { return this.hp <= 0; }
  get laserLock() { return this.laser.charge > 0.03 || this.laser.firing; }

  // targets: array of { id, body, alive, takeHit(dmg, fromPos, knockback) }
  update(dt, targets) {
    const b = this.body;
    if (this.invulnT > 0) this.invulnT -= dt;

    this.updateRockets(dt, targets);

    if (this.ragdollT > 0) {
      this.ragdollT -= dt;
      this.laser.charge = 0; this.laser.firing = false;
      if (this.ragdollT <= 0) this.getUp();
      return;
    }
    if (this.isDead) return;

    // --- ground probe ---
    const from = b.position;
    const to = new CANNON.Vec3(from.x, from.y - MECH.standHeight * 1.35, from.z);
    const ray = new CANNON.RaycastResult();
    this.world.raycastClosest(from, to, { skipBackfaces: true }, ray);
    const hitDist = ray.hasHit && ray.body !== b ? from.y - ray.hitPointWorld.y : Infinity;
    this.grounded = hitDist < MECH.standHeight * 1.15;

    // --- hover (stiff, heavy suspension) ---
    if (this.grounded) {
      const compress = MECH.standHeight - hitDist;
      let f = compress * MECH.hoverStrength - b.velocity.y * MECH.hoverDamping
        + b.mass * -this.world.gravity.y;
      if (f < 0) f = 0;
      b.applyForce(new CANNON.Vec3(0, f, 0));
    }

    // --- balance: strong upright torque, sabotaged while kicking ---
    const balanceMul = this.kick.phase === 'idle' ? 1 : MECH.kick.balanceFactor;
    const curUp = new CANNON.Vec3(0, 1, 0);
    b.quaternion.vmult(curUp, curUp);
    const axis = curUp.cross(UP);
    const angle = Math.asin(Math.min(1, axis.length()));
    if (axis.length() > 1e-6) axis.normalize();
    const torque = axis.scale(angle * MECH.balanceStrength * balanceMul);
    torque.x -= b.angularVelocity.x * MECH.balanceDamping * balanceMul;
    torque.z -= b.angularVelocity.z * MECH.balanceDamping * balanceMul;
    b.torque.vadd(torque, b.torque);

    // --- turn to face where the head looks (slow, weighty) ---
    const fwd = new CANNON.Vec3(0, 0, -1);
    b.quaternion.vmult(fwd, fwd);
    const curYaw = Math.atan2(-fwd.x, -fwd.z);
    let yawErr = this.input.headYaw - curYaw;
    while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
    while (yawErr < -Math.PI) yawErr += 2 * Math.PI;
    b.torque.y += yawErr * MECH.turnTorque - b.angularVelocity.y * MECH.turnDamping;
    this.facingYaw = curYaw;

    // --- walking (locked while the laser is charging/firing or kicking) ---
    const mv = this.input.move;
    const mlen = Math.hypot(mv.x, mv.z);
    const canWalk = this.kick.phase !== 'windup' && this.kick.phase !== 'swing';
    if (mlen > 0.01 && this.grounded && canWalk) {
      const yaw = this.input.legsYaw;
      const nx = mv.x / Math.max(1, mlen), nz = mv.z / Math.max(1, mlen);
      const wx = nx * Math.cos(yaw) + nz * Math.sin(yaw);
      const wz = -nx * Math.sin(yaw) + nz * Math.cos(yaw);
      let maxSpd = MECH.maxWalkSpeed * (1 + 0.12 * this.upgrades.speed);
      if (this.laserLock) maxSpd *= 0.3; // firing on the move, slowly — cinematic
      const hSpeed = Math.hypot(b.velocity.x, b.velocity.z);
      if (hSpeed < maxSpd) {
        b.applyForce(new CANNON.Vec3(wx * MECH.walkForce, 0, wz * MECH.walkForce), new CANNON.Vec3(0, 0.4, 0));
      }
    } else if (this.grounded) {
      // heavy things PLANT their feet — brake hard when not driving,
      // otherwise the hovering torso ice-skates around the plaza
      const br = MECH.brakeRate;
      b.applyForce(new CANNON.Vec3(-b.velocity.x * b.mass * br, 0, -b.velocity.z * b.mass * br));
    }
    this.walkSpeed = Math.hypot(b.velocity.x, b.velocity.z);

    // --- thundering footsteps ---
    if (this.grounded && this.walkSpeed > 0.6) {
      this.stepAccum += this.walkSpeed * dt;
      if (this.stepAccum >= MECH.stepLength) {
        this.stepAccum = 0;
        this.stepSide = 1 - this.stepSide;
        this.events.push({ what: 'step', side: this.stepSide });
      }
    }

    // DASH THRUSTERS (rare find): a violent sideways lunge
    if (this.dashCd > 0) this.dashCd -= dt;
    const dashPressed = this.input.dash && !this.prevDash;
    this.prevDash = this.input.dash;
    if (dashPressed && this.upgrades.dash && this.dashCd <= 0 && this.grounded) {
      const yawD = this.input.legsYaw;
      const dx = mlen > 0.01 ? (mv.x / mlen) : 0, dz = mlen > 0.01 ? (mv.z / mlen) : -1;
      const wx = dx * Math.cos(yawD) + dz * Math.sin(yawD);
      const wz = -dx * Math.sin(yawD) + dz * Math.cos(yawD);
      b.applyImpulse(new CANNON.Vec3(wx * 1500, 90, wz * 1500));
      this.dashCd = 3;
      this.events.push({ what: 'dash' });
    }

    // SHOULDER TURRET (rare find): tracks and pesters the nearest hostile
    if (this.upgrades.turret) {
      this.turretCd -= dt;
      if (this.turretCd <= 0) {
        let best = null, bd = 38;
        for (const tg of targets) {
          if (!tg.alive || tg.body === b || tg.id === 'car') continue;
          const d = tg.body.position.distanceTo(b.position);
          if (d < bd) { bd = d; best = tg; }
        }
        if (best) {
          this.turretCd = 1.1;
          const dealt = best.takeHit(9, b.position, 120, 'turret');
          this.stats.damageDealt += dealt ?? 9;
          this.stats.byPart.TURRET = (this.stats.byPart.TURRET || 0) + (dealt ?? 9);
          const p = best.body.position;
          this.events.push({ what: 'turretFire', to: [rnd(p.x), rnd(p.y), rnd(p.z)] });
          this.events.push({ what: 'dmgNum', p: [rnd(p.x), rnd(p.y + 3), rnd(p.z)], dmg: Math.round(dealt ?? 9) });
        } else {
          this.turretCd = 0.3;
        }
      }
    }

    this.updateCannon(dt, targets);
    this.updatePods(dt, targets);
    this.updatePunches(dt, targets);
    this.updateKick(dt, targets);
    this.updateLaser(dt, targets);

    // --- falling over ---
    const uprightness = curUp.dot(UP);
    if (uprightness < MECH.fallDotThreshold) {
      this.tiltT += dt;
      if (this.tiltT > MECH.fallGraceSec) this.startRagdoll();
    } else {
      this.tiltT = 0;
    }
    if (b.position.y < -20) { this.body.position.copy(this.spawn); this.body.velocity.setZero(); }
  }

  // ---------------------------------------------------------- rotary cannon
  updateCannon(dt, targets) {
    this.updateTracers(dt, targets);
    const W = WEAPONS.cannon;
    if (!this.upgrades.cannon) { this.cannonSpin = Math.max(0, this.cannonSpin - dt * 2); return; }
    if (this.input.spin && !this.laserLock) {
      this.cannonSpin = Math.min(1, this.cannonSpin + dt / W.spinUp);
      if (this.cannonSpin >= 1) {
        this.cannonCd -= dt;
        if (this.cannonCd <= 0) {
          this.cannonCd = 60 / W.rpm;
          const yaw = this.input.armYawR + (Math.random() - 0.5) * W.spread;
          const pitch = this.input.armPitchR;
          const dir = aimDir(yaw, pitch);
          const from = this.body.position.clone(); from.y += 1;
          from.x += dir.x * 3; from.z += dir.z * 3;
          this.tracers.push({ p: from, v: dir.scale(W.tracerSpeed), t: 0 });
          this.events.push({ what: 'cannonFire', p: [rnd(from.x), rnd(from.y), rnd(from.z)] });
          // slight recoil
          this.body.applyImpulse(dir.scale(-25));
        }
      }
    } else {
      this.cannonSpin = Math.max(0, this.cannonSpin - dt * 1.5);
      this.cannonCd = 0;
    }
  }

  updateTracers(dt, targets) {
    const W = WEAPONS.cannon;
    for (const tr of this.tracers) {
      tr.t += dt;
      const step = tr.v.scale(dt, new CANNON.Vec3());
      tr.p.vadd(step, tr.p);
      for (const tg of targets) {
        if (!tg.alive || tg.body === this.body || tg.id === 'car') continue;
        if (tg.body.position.distanceTo(tr.p) < (tg.radius || 2) + 1) {
          const dealt = tg.takeHit(W.damage * (1 + 0.2 * this.upgrades.dmg), tr.p, 60, 'ranged');
          this.stats.damageDealt += dealt ?? W.damage;
          this.stats.byPart.ARMS = (this.stats.byPart.ARMS || 0) + (dealt ?? W.damage);
          tr.t = 99; break;
        }
      }
      if (tr.p.distanceTo(this.body.position) > W.range) tr.t = 99;
    }
    this.tracers = this.tracers.filter((tr) => tr.t < 90);
  }

  // ------------------------------------------------------------ rocket pods
  updatePods(dt, targets) {
    this.updateMissiles(dt, targets);
    const W = WEAPONS.pods;
    if (!this.upgrades.pods) return;
    if (this.podAmmo === 0 && this.podRegen === 0) this.podAmmo = W.maxAmmo; // first install
    if (this.podAmmo < W.maxAmmo) {
      this.podRegen += dt;
      if (this.podRegen >= W.regenSec) { this.podRegen = 0; this.podAmmo++; this.events.push({ what: 'podReload' }); }
    }
    const pressed = this.input.launch && !this.prevLaunch;
    this.prevLaunch = this.input.launch;
    if (pressed && this.podAmmo > 0 && (this.podFireCd || 0) <= 0) {
      this.podAmmo--;
      this.podFireCd = W.reload;
      // acquire nearest hostile as homing target
      let best = null, bd = 90;
      for (const tg of targets) {
        if (!tg.alive || tg.body === this.body || tg.id === 'car') continue;
        const d = tg.body.position.distanceTo(this.body.position);
        if (d < bd) { bd = d; best = tg; }
      }
      const dir = aimDir(this.input.headYaw, this.input.headPitch + 0.2);
      const from = this.body.position.clone(); from.y += 3;
      this.missiles.push({ p: from, v: dir.scale(W.speed), t: 0, target: best });
      this.events.push({ what: 'podFire', p: [rnd(from.x), rnd(from.y), rnd(from.z)] });
    }
    if (this.podFireCd > 0) this.podFireCd -= dt;
  }

  updateMissiles(dt, targets) {
    const W = WEAPONS.pods;
    for (const ms of this.missiles) {
      ms.t += dt;
      // home toward target
      if (ms.target && ms.target.alive) {
        const to = ms.target.body.position.vsub(ms.p);
        to.normalize();
        ms.v.vadd(to.scale(W.speed * 2.5 * dt), ms.v);
        const sp = ms.v.length();
        if (sp > W.speed) ms.v.scale(W.speed / sp, ms.v);
      }
      ms.p.vadd(ms.v.scale(dt, new CANNON.Vec3()), ms.p);
      // detonate near any hostile
      let hit = null;
      for (const tg of targets) {
        if (!tg.alive || tg.body === this.body || tg.id === 'car') continue;
        if (tg.body.position.distanceTo(ms.p) < (tg.radius || 2) + 2) { hit = tg; break; }
      }
      if (hit || ms.t > 4) {
        if (hit) {
          // splash
          for (const tg of targets) {
            if (!tg.alive || tg.body === this.body || tg.id === 'car') continue;
            if (tg.body.position.distanceTo(ms.p) < W.splash) {
              const dealt = tg.takeHit(W.damage, ms.p, 1500, 'rocket');
              this.stats.damageDealt += dealt ?? W.damage;
              this.stats.byPart.HEAD = (this.stats.byPart.HEAD || 0) + (dealt ?? W.damage);
            }
          }
          this.events.push({ what: 'podHit', p: [rnd(ms.p.x), rnd(ms.p.y), rnd(ms.p.z)] });
          this.onWorldHit?.(ms.p, 'rocket');
        }
        ms.t = 99;
      }
    }
    this.missiles = this.missiles.filter((ms) => ms.t < 90);
  }

  // ---------------------------------------------------------------- punches
  updatePunches(dt, targets) {
    for (const side of ['L', 'R']) {
      const arm = this.arms[side];
      const pressed = side === 'L' ? this.input.punchL : this.input.punchR;
      arm.t += dt;
      const P = MECH.punch;
      switch (arm.phase) {
        case 'idle':
          if (pressed && !this.laserLock) {
            arm.phase = 'windup'; arm.t = 0;
            this.events.push({ what: 'punchWindup', side });
          }
          break;
        case 'windup':
          if (arm.t >= P.windup) {
            arm.phase = 'swing'; arm.t = 0;
            this.stats.punches++;
            this.resolvePunch(side, targets);
          }
          break;
        case 'swing':
          if (arm.t >= P.swing) { arm.phase = 'recover'; arm.t = 0; }
          break;
        case 'recover':
          if (arm.t >= P.recover) { arm.phase = 'idle'; arm.t = 0; }
          break;
      }
    }
  }

  resolvePunch(side, targets) {
    const P = MECH.punch;
    const yaw = side === 'L' ? this.input.armYawL : this.input.armYawR;
    const dmg = P.damage * (1 + 0.2 * this.upgrades.dmg);
    const hit = this.sweepHit(targets, yaw, P.range, P.arc, dmg, P.knockback, 'ARMS');
    if (hit) {
      this.events.push({ what: 'punchHit', side });
    } else {
      this.events.push({ what: 'punchMiss', side });
      if (this.upgrades.rocket) this.launchRocket(side, yaw);
    }
    // the fist also meets the world (buildings crumble under it)
    const reach = aimDir(yaw, 0).scale(P.range * 0.7);
    this.onWorldHit?.(new CANNON.Vec3(
      this.body.position.x + reach.x, this.body.position.y + 1.5, this.body.position.z + reach.z), 'punch');
  }

  launchRocket(side, yaw) {
    const pitch = side === 'L' ? this.input.armPitchL : this.input.armPitchR;
    const dir = aimDir(yaw, pitch);
    const start = this.body.position.clone();
    start.y += 1.5;
    start.x += dir.x * 4; start.z += dir.z * 4;
    this.rockets.push({
      side,
      p: start,
      v: dir.scale(34),
      t: 0,
    });
    this.events.push({ what: 'rocketFire', side });
  }

  updateRockets(dt, targets) {
    for (const r of this.rockets) {
      r.t += dt;
      r.p.vadd(r.v.scale(dt, new CANNON.Vec3()), r.p);
      for (const tg of targets) {
        if (!tg.alive || tg.body === this.body) continue;
        if (tg.body.position.distanceTo(r.p) < 4.2) {
          const dealt = tg.takeHit(26, r.p, 1400, 'rocket');
          this.stats.damageDealt += dealt ?? 26;
          this.stats.byPart.ARMS = (this.stats.byPart.ARMS || 0) + (dealt ?? 26);
          this.events.push({ what: 'rocketHit', p: [rnd(r.p.x), rnd(r.p.y), rnd(r.p.z)] });
          this.events.push({ what: 'dmgNum', p: [rnd(r.p.x), rnd(r.p.y + 2), rnd(r.p.z)], dmg: Math.round(dealt ?? 26) });
          this.onWorldHit?.(r.p, 'rocket');
          r.t = 99;
          break;
        }
      }
    }
    this.rockets = this.rockets.filter((r) => r.t < 1.6);
  }

  // ------------------------------------------------------------------- kick
  updateKick(dt, targets) {
    const K = MECH.kick;
    const k = this.kick;
    k.t += dt;
    switch (k.phase) {
      case 'idle':
        if (this.input.kick && !this.laserLock) {
          k.phase = 'windup'; k.t = 0;
          this.events.push({ what: 'kickWindup' });
        }
        break;
      case 'windup':
        if (k.t >= K.windup) {
          k.phase = 'swing'; k.t = 0;
          this.stats.kicks++;
          this.kickSwung = true; // game modes use this to shake off swarmlings
          const hit = this.sweepHit(targets, this.facingYaw, K.range, K.arc, K.damage * (1 + 0.2 * this.upgrades.dmg), K.knockback, 'LEGS');
          this.events.push({ what: hit ? 'kickHit' : 'kickMiss' });
          // a mech-scale kick takes chunks out of whatever it lands beside
          const kr = aimDir(this.facingYaw, 0).scale(K.range * 0.7);
          this.onWorldHit?.(new CANNON.Vec3(
            this.body.position.x + kr.x, this.body.position.y - 1, this.body.position.z + kr.z), 'kick');
          // kicking shoves the kicker backward a little too (physics comedy)
          const back = aimDir(this.facingYaw, 0).scale(-260);
          this.body.applyImpulse(new CANNON.Vec3(back.x, 60, back.z));
        }
        break;
      case 'swing':
        if (k.t >= K.swing) { k.phase = 'recover'; k.t = 0; }
        break;
      case 'recover':
        if (k.t >= K.recover) { k.phase = 'idle'; k.t = 0; }
        break;
    }
  }

  // ------------------------------------------------------------------ laser
  updateLaser(dt, targets) {
    const L = MECH.laser;
    const chargeTime = L.chargeTime * Math.pow(0.9, this.upgrades.laser);
    const lz = this.laser;

    // aim guide: the whole crew always sees where the eye is pointing
    const cast = this.castBeam(targets);
    lz.aim = [rnd(cast.end.x), rnd(cast.end.y), rnd(cast.end.z)];
    lz.aimHit = !!cast.target;

    if (lz.firing) {
      lz.fireT += dt;
      const dmg = L.dps * (1 + 0.25 * this.upgrades.laser) * dt;
      if (cast.target) {
        const dealt = cast.target.takeHit(dmg, cast.from, 60, 'laser');
        this.stats.damageDealt += dealt ?? dmg;
        this.stats.byPart.HEAD = (this.stats.byPart.HEAD || 0) + (dealt ?? dmg);
        this.laserDmgAcc = (this.laserDmgAcc || 0) + (dealt ?? dmg);
        if (this.laserDmgAcc >= 20) {
          const p = cast.target.body.position;
          this.events.push({ what: 'dmgNum', p: [rnd(p.x), rnd(p.y + (cast.target.radius || 2) + 1), rnd(p.z)], dmg: Math.round(this.laserDmgAcc), laser: true });
          this.laserDmgAcc = 0;
        }
      }
      lz.from = [rnd(cast.from.x), rnd(cast.from.y), rnd(cast.from.z)];
      lz.to = lz.aim;
      lz.hitting = !!cast.target;
      // the beam carves whatever structure it lands on
      this.onWorldHit?.(cast.end, 'laser', dmg);
      if (lz.fireT >= L.fireTime) { lz.firing = false; lz.charge = 0; lz.from = lz.to = null; }
      return;
    }

    if (this.input.fire) {
      if (lz.charge === 0) this.events.push({ what: 'laserCharge' });
      lz.charge = Math.min(1, lz.charge + dt / chargeTime);
      if (lz.charge >= 1) {
        lz.firing = true; lz.fireT = 0;
        this.laserDmgAcc = 0;
        this.stats.lasers++;
        this.events.push({ what: 'laserFire' });
      }
    } else if (lz.charge > 0) {
      lz.charge = 0;
      this.events.push({ what: 'laserFizzle' });
    }
  }

  // Where does the eye-line hit? Used for the guide AND the beam itself.
  castBeam(targets) {
    const L = MECH.laser;
    const dir = aimDir(this.input.headYaw, this.input.headPitch);
    const from = this.body.position.clone();
    from.y += MECH.torsoSize.y / 2 + 1.2;
    let hitTarget = null, hitDist = L.range;
    for (const tg of targets) {
      if (!tg.alive || tg.body === this.body) continue;
      const toT = tg.body.position.vsub(from);
      const along = toT.dot(dir);
      if (along < 0 || along > L.range) continue;
      const closest = from.clone().vadd(dir.scale(along, new CANNON.Vec3()));
      const off = closest.distanceTo(tg.body.position);
      if (off < L.beamRadius + (tg.radius || 3) && along < hitDist) {
        hitDist = along;
        hitTarget = tg;
      }
    }
    // no monster in the way: end the guide at the ground plane if aiming down
    let end;
    if (hitTarget) {
      end = from.clone().vadd(dir.scale(hitDist, new CANNON.Vec3()));
    } else if (dir.y < -0.02) {
      const t = Math.min(L.range, -from.y / dir.y);
      end = from.clone().vadd(dir.scale(t, new CANNON.Vec3()));
    } else {
      end = from.clone().vadd(dir.scale(L.range, new CANNON.Vec3()));
    }
    return { from, end, target: hitTarget, dist: hitDist };
  }

  // Shared melee wedge check. Returns true if anything got hit.
  sweepHit(targets, yaw, range, arc, dmg, knockback, part = 'ARMS') {
    let hit = false;
    const origin = this.body.position;
    for (const tg of targets) {
      if (!tg.alive || tg.body === this.body) continue;
      const d = tg.body.position.vsub(origin);
      const dist = Math.hypot(d.x, d.z);
      if (dist > range + (tg.radius || 0)) continue;
      const dirYaw = Math.atan2(-d.x, -d.z);
      let diff = dirYaw - yaw;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) > arc / 2 && dist > 3) continue; // point-blank always counts
      const dealt = tg.takeHit(dmg, origin, knockback);
      const p = tg.body.position;
      this.events.push({ what: 'dmgNum', p: [rnd(p.x), rnd(p.y + (tg.radius || 2) + 1), rnd(p.z)], dmg: Math.round(dealt ?? dmg) });
      this.stats.damageDealt += dealt ?? dmg;
      this.stats.byPart[part] = (this.stats.byPart[part] || 0) + (dealt ?? dmg);
      hit = true;
    }
    return hit;
  }

  // ----------------------------------------------------------------- damage
  takeHit(dmg, fromPos, knockback = 0) {
    if (this.isDead || this.invulnT > 0) return;
    const scaled = dmg * (1 - Math.min(0.6, 0.1 * this.upgrades.armor));
    this.hp = Math.max(0, this.hp - scaled);
    this.events.push({ what: 'hurt', dmg: Math.round(scaled) });
    if (knockback && fromPos) {
      const dir = this.body.position.vsub(fromPos);
      dir.y = 0;
      if (dir.length() > 0.01) dir.normalize();
      dir.y = 0.35;
      this.body.applyImpulse(dir.scale(knockback));
    }
    if (this.hp <= 0) this.events.push({ what: 'die' });
  }

  startRagdoll() {
    if (this.isRagdoll) return;
    this.ragdollT = MECH.ragdollSec;
    this.tiltT = 0;
    this.stats.falls++;
    this.laser.charge = 0; this.laser.firing = false;
    this.body.angularDamping = 0.15;
    this.events.push({ what: 'fell' });
  }

  getUp() {
    const b = this.body;
    b.position.y = MECH.standHeight + 0.5;
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.quaternion.setFromEuler(0, this.input.headYaw, 0);
    b.angularDamping = 0.6;
    this.ragdollT = 0;
    this.invulnT = 1.2;
    this.events.push({ what: 'getUp' });
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  snapshot() {
    const b = this.body;
    const snap = {
      id: this.id,
      color: this.color,
      p: [rnd(b.position.x), rnd(b.position.y), rnd(b.position.z)],
      q: [rnd(b.quaternion.x), rnd(b.quaternion.y), rnd(b.quaternion.z), rnd(b.quaternion.w)],
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      walk: rnd(this.walkSpeed),
      grounded: this.grounded,
      ragdoll: this.isRagdoll,
      dead: this.isDead,
      head: { yaw: rnd(this.input.headYaw), pitch: rnd(this.input.headPitch) },
      arms: {
        L: { yaw: rnd(this.input.armYawL), pitch: rnd(this.input.armPitchL), phase: this.arms.L.phase, t: rnd(this.arms.L.t) },
        R: { yaw: rnd(this.input.armYawR), pitch: rnd(this.input.armPitchR), phase: this.arms.R.phase, t: rnd(this.arms.R.t) },
      },
      kick: { phase: this.kick.phase, t: rnd(this.kick.t) },
      laser: {
        charge: rnd(this.laser.charge),
        firing: this.laser.firing,
        from: this.laser.firing ? this.laser.from : null,
        to: this.laser.firing ? this.laser.to : null,
        hitting: !!this.laser.hitting,
        aim: this.laser.aim || null,
        aimHit: !!this.laser.aimHit,
      },
      rockets: this.rockets.map((r) => ({ side: r.side, p: [rnd(r.p.x), rnd(r.p.y), rnd(r.p.z)] })),
      cannonSpin: rnd(this.cannonSpin),
      tracers: this.tracers.map((t) => ({ p: [rnd(t.p.x), rnd(t.p.y), rnd(t.p.z)] })),
      missiles: this.missiles.map((ms) => ({ p: [rnd(ms.p.x), rnd(ms.p.y), rnd(ms.p.z)] })),
      podAmmo: this.podAmmo,
      up: this.upgrades,
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}

function aimDir(yaw, pitch) {
  return new CANNON.Vec3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );
}
function rnd(n) { return Math.round(n * 1000) / 1000; }
