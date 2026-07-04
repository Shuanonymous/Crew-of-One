import * as CANNON from 'cannon-es';
import { MONSTERS, BOSS_NAMES } from '../shared/constants.js';

// The kaiju roster. Six behaviors, one class:
//   melee  — walk up, telegraph, swipe (crab / pigeon / rusher / tank)
//   ranged — keep distance, lob projectiles (spitter)
//   flyer  — circle above, telegraph, DIVE (flyer)
//   swarm  — sprint in, latch onto the mech, chew (swarmling)
//   boss   — big named kaiju with 3 patterns (swipe combo / summon / slam)

let nextId = 1;
let bossCounter = 0;

export class Monster {
  constructor(world, type, pos, wave) {
    const def = MONSTERS[type];
    this.world = world;
    this.def = def;
    this.type = type;
    this.behavior = def.behavior;
    this.id = 'm' + nextId++;
    this.wave = wave;

    this.maxHp = Math.round(def.hp + def.hpPerWave * (wave - 1));
    this.hp = this.maxHp;
    this.damage = def.damage + (def.damagePerWave || 0) * (wave - 1);
    this.radius = def.radius;
    this.credits = def.credits;
    if (this.behavior === 'boss') {
      this.bossName = BOSS_NAMES[bossCounter++ % BOSS_NAMES.length];
    }

    const startY = this.behavior === 'flyer' ? def.altitude : def.radius + 0.5;
    this.body = new CANNON.Body({
      mass: def.mass,
      shape: new CANNON.Sphere(def.radius),
      position: new CANNON.Vec3(pos.x, startY, pos.z),
      linearDamping: this.behavior === 'flyer' ? 0.15 : 0.6,
      angularDamping: 0.9,
    });
    this.body.allowSleep = false;
    world.addBody(this.body);

    this.state = 'spawn';
    this.t = 0;
    this.yaw = 0;
    this.attackKind = 'hit';
    this.deadT = 0;
    this.removed = false;
    this.staggerT = 0;
    this.latched = false;
    this.latchOffset = null;
    this.circleDir = Math.random() < 0.5 ? 1 : -1;
    this.diveCooldown = 2 + Math.random() * 2;
    this.pendingProjectile = null;  // game collects these
    this.pendingSummon = 0;
    this.comboHits = 0;
    this.events = [{ what: 'roar' }];
  }

  get alive() { return this.hp > 0; }

  update(dt, target) {
    const b = this.body;
    this.t += dt;

    if (!this.alive) {
      this.state = 'dead';
      this.deadT += dt;
      if (this.latched) { this.latched = false; b.collisionResponse = true; }
      if (this.deadT > 2.2 && !this.removed) {
        this.removed = true;
        this.world.removeBody(b);
      }
      return;
    }
    if (this.behavior === 'flyer') {
      // anti-gravity: flyers ignore the planet's opinion
      b.applyForce(new CANNON.Vec3(0, b.mass * -this.world.gravity.y, 0));
    }
    if (this.staggerT > 0) { this.staggerT -= dt; return; }
    if (!target) return;

    const toT = target.body.position.vsub(b.position);
    const flatDist = Math.hypot(toT.x, toT.z);
    if (flatDist > 0.01 && !this.latched) {
      const wantYaw = Math.atan2(-toT.x, -toT.z);
      let d = wantYaw - this.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += Math.max(-3 * dt, Math.min(3 * dt, d));
    }

    switch (this.behavior) {
      case 'melee': this.updateMelee(dt, target, toT, flatDist); break;
      case 'ranged': this.updateRanged(dt, target, toT, flatDist); break;
      case 'flyer': this.updateFlyer(dt, target, toT, flatDist); break;
      case 'swarm': this.updateSwarm(dt, target, toT, flatDist); break;
      case 'boss': this.updateBoss(dt, target, toT, flatDist); break;
    }
  }

  // ------------------------------------------------------------------ melee
  updateMelee(dt, target, toT, dist) {
    const def = this.def;
    switch (this.state) {
      case 'spawn':
        if (this.t > 1.2) this.setState('walk');
        break;
      case 'walk':
        if (dist > def.attackRange) this.chase(toT, def.speed);
        else {
          this.setState('telegraph');
          this.attackKind = this.type === 'pigeon' && Math.random() < 0.35 ? 'gust' : 'hit';
          this.events.push({ what: 'telegraph', kind: this.attackKind });
        }
        break;
      case 'telegraph':
        if (this.t > def.telegraph) {
          this.setState('attack');
          this.strikeDone = false;
          this.events.push({ what: 'attack', kind: this.attackKind });
        }
        break;
      case 'attack':
        if (!this.strikeDone && this.t > def.attackDur * 0.5) {
          this.strikeDone = true;
          if (this.attackKind === 'gust') {
            if (dist < def.attackRange * 2.2) {
              target.takeHit(0, this.body.position, def.knockback * 1.8);
              this.events.push({ what: 'gustHit' });
            }
          } else if (dist < def.attackRange * 1.25) {
            target.takeHit(this.damage, this.body.position, def.knockback);
            this.events.push({ what: 'strikeHit' });
          }
        }
        if (this.t > def.attackDur) this.setState('recover');
        break;
      case 'recover':
        if (this.t > def.recover) this.setState('walk');
        break;
    }
  }

  // ----------------------------------------------------------------- ranged
  updateRanged(dt, target, toT, dist) {
    const def = this.def;
    switch (this.state) {
      case 'spawn':
        if (this.t > 1.2) this.setState('walk');
        break;
      case 'walk': {
        if (dist < def.preferredRange) {
          // too close! waddle away while glaring
          const away = new CANNON.Vec3(-toT.x, 0, -toT.z);
          this.chase(away, def.speed * 1.3);
        } else if (dist > def.attackRange) {
          this.chase(toT, def.speed);
        }
        if (dist <= def.attackRange && this.t > 1.2) {
          this.setState('telegraph');
          this.events.push({ what: 'telegraph', kind: 'spit' });
        }
        break;
      }
      case 'telegraph':
        if (this.t > def.telegraph) {
          this.setState('attack');
          // lob a glob at where the mech IS (dodgeable by moving — teamwork!)
          const from = this.body.position.clone();
          from.y += this.radius + 0.5;
          const to = target.body.position.clone();
          const flat = to.vsub(from);
          const d = Math.hypot(flat.x, flat.z);
          const flightT = Math.max(0.7, d / def.projSpeed);
          this.pendingProjectile = {
            p: from,
            v: new CANNON.Vec3(flat.x / flightT, flat.y / flightT + 0.5 * 20 * flightT, flat.z / flightT),
            radius: def.projRadius,
            damage: this.damage,
          };
          this.events.push({ what: 'spit' });
        }
        break;
      case 'attack':
        if (this.t > def.attackDur) this.setState('recover');
        break;
      case 'recover':
        if (this.t > def.recover) this.setState('walk');
        break;
    }
  }

  // ------------------------------------------------------------------ flyer
  updateFlyer(dt, target, toT, dist) {
    const def = this.def;
    const b = this.body;
    switch (this.state) {
      case 'spawn':
        if (this.t > 1.0) this.setState('walk'); // 'walk' = circling
        break;
      case 'walk': {
        // orbit the mech at altitude
        const angle = Math.atan2(b.position.z - target.body.position.z, b.position.x - target.body.position.x);
        const next = angle + this.circleDir * 0.5;
        const want = new CANNON.Vec3(
          target.body.position.x + Math.cos(next) * def.circleRadius,
          def.altitude,
          target.body.position.z + Math.sin(next) * def.circleRadius
        );
        const dir = want.vsub(b.position);
        if (dir.length() > 0.1) {
          dir.normalize();
          b.velocity.x += (dir.x * def.speed - b.velocity.x) * Math.min(1, 4 * dt);
          b.velocity.y += (dir.y * def.speed - b.velocity.y) * Math.min(1, 4 * dt);
          b.velocity.z += (dir.z * def.speed - b.velocity.z) * Math.min(1, 4 * dt);
        }
        this.diveCooldown -= dt;
        if (this.diveCooldown <= 0) {
          this.setState('telegraph');
          this.events.push({ what: 'telegraph', kind: 'dive' });
        }
        break;
      }
      case 'telegraph':
        b.velocity.scale(0.9, b.velocity); // hover menacingly
        if (this.t > def.telegraph) {
          this.setState('attack');
          // lock the dive line at the mech's CURRENT position — sidestep it!
          const aim = target.body.position.clone();
          aim.y += 4;
          const dir = aim.vsub(b.position);
          dir.normalize();
          b.velocity.copy(dir.scale(def.diveSpeed));
          this.strikeDone = false;
          this.events.push({ what: 'attack', kind: 'dive' });
        }
        break;
      case 'attack': {
        if (!this.strikeDone && dist < this.radius + 4.5 && Math.abs(toT.y) < 7) {
          this.strikeDone = true;
          target.takeHit(this.damage, this.body.position, def.knockback);
          this.events.push({ what: 'strikeHit' });
        }
        if (this.t > 1.6 || b.position.y < 3) this.setState('recover');
        break;
      }
      case 'recover': {
        // climb back up
        b.velocity.y += (def.speed - b.velocity.y) * Math.min(1, 3 * dt);
        if (b.position.y >= def.altitude - 1 || this.t > 3) {
          this.diveCooldown = def.divePeriod * (0.8 + Math.random() * 0.4);
          this.setState('walk');
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ swarm
  updateSwarm(dt, target, toT, dist) {
    const def = this.def;
    const b = this.body;
    if (this.latched) {
      // ride the mech, chewing
      const q = target.body.quaternion;
      const world = q.vmult(this.latchOffset);
      b.position.copy(target.body.position.vadd(world));
      b.velocity.setZero();
      target.takeHit(this.damage * dt, null, 0);
      return;
    }
    if (this.state === 'spawn') {
      if (this.t > 0.5) this.setState('walk');
      return;
    }
    if (dist < def.latchRange + 2.5) {
      this.latched = true;
      b.collisionResponse = false;
      // grab a random spot on the torso
      this.latchOffset = new CANNON.Vec3(
        (Math.random() - 0.5) * 4.5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 3.5
      );
      const len = this.latchOffset.length();
      if (len < 2) this.latchOffset.scale(2 / Math.max(0.1, len), this.latchOffset);
      this.events.push({ what: 'latch' });
      this.setState('attack');
    } else {
      this.chase(toT, def.speed);
    }
  }

  // ------------------------------------------------------------------- boss
  updateBoss(dt, target, toT, dist) {
    const def = this.def;
    switch (this.state) {
      case 'spawn':
        if (this.t > 2.2) this.setState('walk');
        break;
      case 'walk':
        if (dist > def.attackRange) this.chase(toT, def.speed);
        else {
          // pick a pattern: swipe combo / summon / slam
          const roll = Math.random();
          this.attackKind = roll < 0.45 ? 'combo' : roll < 0.7 ? 'summon' : 'slam';
          const tele = this.attackKind === 'slam' ? def.slam.telegraph : def.telegraph;
          this.teleTime = tele;
          this.comboHits = 0;
          this.setState('telegraph');
          this.events.push({ what: 'telegraph', kind: this.attackKind });
        }
        break;
      case 'telegraph':
        if (this.t > this.teleTime) {
          this.setState('attack');
          this.strikeDone = false;
          this.events.push({ what: 'attack', kind: this.attackKind });
        }
        break;
      case 'attack': {
        if (this.attackKind === 'combo') {
          // three quick swipes, each can hit
          const hitAt = 0.25 + this.comboHits * 0.55;
          if (this.t > hitAt && this.comboHits < 3) {
            this.comboHits++;
            if (dist < def.attackRange * 1.3) {
              target.takeHit(this.damage * 0.6, this.body.position, def.knockback * 0.5);
              this.events.push({ what: 'strikeHit' });
            }
          }
          if (this.comboHits >= 3) this.setState('recover');
        } else if (this.attackKind === 'summon') {
          if (!this.strikeDone) {
            this.strikeDone = true;
            this.pendingSummon = 3 + Math.floor(this.wave / 5);
            this.events.push({ what: 'summon' });
          }
          if (this.t > 0.8) this.setState('recover');
        } else { // slam
          if (!this.strikeDone && this.t > 0.25) {
            this.strikeDone = true;
            const p = this.body.position;
            if (dist < def.slam.range) {
              target.takeHit(def.slam.damage, p, def.slam.knockback);
            }
            this.events.push({ what: 'slam', p: [r3(p.x), 0.2, r3(p.z)], range: def.slam.range });
          }
          if (this.t > def.attackDur) this.setState('recover');
        }
        break;
      }
      case 'recover':
        if (this.t > def.recover) this.setState('walk');
        break;
    }
  }

  chase(dir, speed) {
    const b = this.body;
    const d = new CANNON.Vec3(dir.x, 0, dir.z);
    if (d.length() < 0.01) return;
    d.normalize();
    const hSpeed = Math.hypot(b.velocity.x, b.velocity.z);
    if (hSpeed < speed) b.applyForce(d.scale(b.mass * 14));
  }

  setState(s) { this.state = s; this.t = 0; }

  // kind: 'melee' | 'laser' | 'rocket'  — tanks & bosses shrug off melee
  takeHit(dmg, fromPos, knockback = 0, kind = 'melee') {
    if (!this.alive) return 0;
    let dealt = dmg;
    if (kind === 'melee' && this.def.meleeResist) dealt = dmg * this.def.meleeResist;
    this.hp = Math.max(0, this.hp - dealt);
    if (dealt >= 4 && this.behavior !== 'boss') {
      this.events.push({ what: 'hit' });
      this.staggerT = Math.max(this.staggerT, 0.3);
    } else if (dealt >= 4) {
      this.events.push({ what: 'hit' });
    }
    if (knockback && fromPos && this.behavior !== 'boss') {
      const dir = this.body.position.vsub(fromPos);
      dir.y = 0;
      if (dir.length() > 0.01) dir.normalize();
      dir.y = 0.5;
      if (this.latched) { this.latched = false; this.body.collisionResponse = true; }
      this.body.applyImpulse(dir.scale(knockback * Math.min(1, 45 / this.body.mass * 3)));
    }
    if (this.hp <= 0) {
      this.events.push({ what: 'die' });
      this.setState('dead');
    }
    return dealt;
  }

  snapshot() {
    const b = this.body;
    const snap = {
      id: this.id,
      type: this.type,
      p: [r3(b.position.x), r3(b.position.y), r3(b.position.z)],
      yaw: r3(this.yaw),
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      state: this.state,
      t: r3(this.t),
      kind: this.attackKind,
      latched: this.latched,
      ev: this.events,
    };
    if (this.bossName) snap.boss = this.bossName;
    this.events = [];
    return snap;
  }
}

function r3(n) { return Math.round(n * 1000) / 1000; }
