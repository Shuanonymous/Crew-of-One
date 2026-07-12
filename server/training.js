import * as CANNON from 'cannon-es';
import { Mech } from './mech.js';
import { Monster } from './monsters.js';
import { buildCity, ARENA_RADIUS } from './city.js';
import { PHYSICS_HZ, PHASE } from '../shared/constants.js';

// TRAINING COURSE — a low-stakes warmup that teaches every role:
// walk through the rings (LEGS), bop the cardboard kaiju (ARMS),
// kick the crate tower (LEGS again, fancy this time), and pop the
// balloon with the laser (HEAD). Timer runs until you finish.

export class TrainingGame {
  constructor(build = null) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.5;

    const city = buildCity(this.world, 42);
    this.cityDefs = city.defs;

    this.mech = new Mech(this.world, 'mech1', { x: 0, y: 8, z: 20 }, '#f5b13d', Math.PI, build);

    // Objectives
    this.setBuild = (b) => this.mech.setBuild(b);   // live component swapping
    this.rings = [
      { id: 0, p: [0, 0, 0], done: false },
      { id: 1, p: [-20, 0, -14], done: false },
      { id: 2, p: [14, 0, -26], done: false },
    ];
    this.dummies = [
      this.makeDummy(-8, -34),
      this.makeDummy(26, -8),
    ];
    // Crate tower to kick over
    this.crates = [];
    for (let i = 0; i < 4; i++) {
      const c = new CANNON.Body({
        mass: 4,
        shape: new CANNON.Box(new CANNON.Vec3(1.6, 1.6, 1.6)),
        position: new CANNON.Vec3(-26, 1.7 + i * 3.3, 24),
      });
      this.world.addBody(c);
      this.crates.push(c);
    }
    this.cratesToppled = false;
    // Balloon for the laser (floats above a rooftop)
    this.balloon = { p: [26, 22, -20], popped: false, radius: 3.5 };

    this.time = 0;
    this.running = true;
    this.phase = PHASE.FIGHT; // reuse: FIGHT = in progress, WIN = done
    this.tick = 0;
    this.events = [{ what: 'trainingStart' }];
  }

  makeDummy(x, z) {
    // A crab that never fights back (it's cardboard)
    const m = new Monster(this.world, 'crab', { x, z }, 1);
    m.hp = 30; m.maxHp = 30;
    m.state = 'walk';
    m.update = (dt) => { // stand perfectly still, menacingly
      m.t += dt;
      if (!m.alive) {
        m.state = 'dead';
        m.deadT += dt;
        if (m.deadT > 2.6 && !m.removed) { m.removed = true; this.world.removeBody(m.body); }
      }
    };
    return m;
  }

  get mechs() { return [this.mech]; }

  get mechTargets() {
    const targets = this.dummies.filter((m) => !m.removed).map((m) => ({
      id: m.id, body: m.body, alive: m.alive, radius: m.radius,
      takeHit: (d, f, k, kind) => m.takeHit(d, f, k, kind),
    }));
    // crates are punchable/kickable too
    for (const c of this.crates) {
      targets.push({
        id: 'crate', body: c, alive: true, radius: 2,
        takeHit: (d, f, k) => {
          if (!f) return;
          const dir = c.position.vsub(f); dir.y = 0;
          if (dir.length() > 0.01) dir.normalize();
          dir.y = 0.6;
          c.applyImpulse(dir.scale(k * 0.12));
        },
      });
    }
    // the balloon is a laser-only target
    targets.push({
      id: 'balloon',
      body: { position: new CANNON.Vec3(...this.balloon.p) },
      alive: !this.balloon.popped,
      radius: this.balloon.radius,
      takeHit: () => {
        if (!this.balloon.popped) {
          this.balloon.popped = true;
          this.events.push({ what: 'balloonPop' });
        }
      },
    });
    return targets;
  }

  applyInput(roles, data, ROLE) {
    const inp = this.mech.input;
    if (roles.includes(ROLE.LEGS)) {
      if (data.move) { inp.move.x = clamp(data.move.x); inp.move.z = clamp(data.move.z); }
      if (typeof data.kick === 'boolean') inp.kick = data.kick;
      if (typeof data.aimYaw === 'number') inp.legsYaw = data.aimYaw;
    }
    if (roles.includes(ROLE.ARM_L)) {
      if (typeof data.punchL === 'boolean') inp.punchL = data.punchL;
      if (typeof data.aimYaw === 'number') inp.armYawL = data.aimYaw;
      if (typeof data.aimPitch === 'number') inp.armPitchL = data.aimPitch;
    }
    if (roles.includes(ROLE.ARM_R)) {
      if (typeof data.punchR === 'boolean') inp.punchR = data.punchR;
      if (typeof data.spin === 'boolean') inp.spin = data.spin;
      if (typeof data.aimYaw === 'number') inp.armYawR = data.aimYaw;
      if (typeof data.aimPitch === 'number') inp.armPitchR = data.aimPitch;
    }
    if (roles.includes(ROLE.HEAD)) {
      if (typeof data.fire === 'boolean') inp.fire = data.fire;
      if (typeof data.launch === 'boolean') inp.launch = data.launch;
      if (typeof data.aimYaw === 'number') inp.headYaw = data.aimYaw;
      if (typeof data.aimPitch === 'number') inp.headPitch = data.aimPitch;
    }
  }

  step() {
    const dt = 1 / PHYSICS_HZ;
    this.tick++;
    if (this.running) this.time += dt;

    this.mech.update(dt, this.mechTargets);
    for (const m of this.dummies) m.update(dt);
    this.dummies = this.dummies.filter((m) => !m.removed);
    this.world.step(dt);

    // ring checks
    for (const ring of this.rings) {
      if (ring.done) continue;
      const dx = this.mech.body.position.x - ring.p[0];
      const dz = this.mech.body.position.z - ring.p[2];
      if (Math.hypot(dx, dz) < 6) {
        ring.done = true;
        this.events.push({ what: 'ringDone', id: ring.id });
      }
    }
    // crate topple check
    if (!this.cratesToppled) {
      const top = this.crates[this.crates.length - 1];
      if (top.position.y < 4 || Math.hypot(top.position.x + 26, top.position.z - 24) > 6) {
        this.cratesToppled = true;
        this.events.push({ what: 'cratesToppled' });
      }
    }

    const allDone = this.rings.every((r) => r.done)
      && this.dummies.every((d) => !d.alive)
      && this.cratesToppled
      && this.balloon.popped;
    if (allDone && this.running) {
      this.running = false;
      this.phase = PHASE.WIN;
      this.events.push({ what: 'trainingDone', time: Math.round(this.time * 10) / 10 });
    }
  }

  get summary() {
    return {
      time: Math.round(this.time * 10) / 10,
      falls: this.mech.stats.falls,
    };
  }

  worldInfo() {
    return {
      city: this.cityDefs,
      arenaRadius: ARENA_RADIUS,
      mode: 'training',
      rings: this.rings.map((r) => ({ id: r.id, p: r.p })),
      balloon: { p: this.balloon.p, radius: this.balloon.radius },
      crateSize: 3.2,
    };
  }

  snapshot() {
    const snap = {
      tick: this.tick,
      time: Date.now(),
      phase: this.phase,
      trainingTime: Math.round(this.time * 10) / 10,
      objectives: {
        rings: this.rings.map((r) => r.done),
        dummies: this.dummies.filter((d) => d.alive).length,
        crates: this.cratesToppled,
        balloon: this.balloon.popped,
      },
      mechs: [this.mech.snapshot()],
      monsters: this.dummies.map((m) => m.snapshot()),
      crates: this.crates.map((c) => ({
        p: [rnd(c.position.x), rnd(c.position.y), rnd(c.position.z)],
        q: [rnd(c.quaternion.x), rnd(c.quaternion.y), rnd(c.quaternion.z), rnd(c.quaternion.w)],
      })),
      ev: this.events,
    };
    if (this.phase === PHASE.WIN) snap.summary = this.summary;
    this.events = [];
    return snap;
  }
}

function clamp(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }
function rnd(n) { return Math.round(n * 1000) / 1000; }
