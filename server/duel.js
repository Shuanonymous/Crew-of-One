import * as CANNON from 'cannon-es';
import { Mech } from './mech.js';
import { buildCity, buildCars, ARENA_RADIUS } from './city.js';
import { PHYSICS_HZ, PHASE } from '../shared/constants.js';

// MECH DUEL — two crews, two mechs, one plaza. Same combat systems as
// the brawl; the other mech is simply the target.

const DUEL_HP = 160;

export class DuelGame {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.5;

    const city = buildCity(this.world, 13);
    this.cityDefs = city.defs;
    const cars = buildCars(this.world, 8, 21);
    this.cars = cars.bodies;
    this.carDefs = cars.defs;

    this.mechA = new Mech(this.world, 'mechA', { x: -18, y: 8, z: 0 }, '#f5b13d', -Math.PI / 2);
    this.mechB = new Mech(this.world, 'mechB', { x: 18, y: 8, z: 0 }, '#7d9df0', Math.PI / 2);
    for (const m of this.mechs) { m.hp = DUEL_HP; m.maxHp = DUEL_HP; }

    this.phase = PHASE.FIGHT;
    this.winner = null;        // 'A' | 'B'
    this.tick = 0;
    this.events = [{ what: 'duelStart' }];
  }

  get mechs() { return [this.mechA, this.mechB]; }

  targetFor(mech) {
    const other = mech === this.mechA ? this.mechB : this.mechA;
    const targets = [{
      id: other.id, body: other.body, alive: !other.isDead, radius: 3.2,
      takeHit: (d, f, k) => { other.takeHit(d, f, k); return d; },
    }];
    for (const c of this.cars) {
      targets.push({
        id: 'car', body: c, alive: true, radius: 1.8,
        takeHit: (d, f, k) => {
          if (!f) return 0;
          const dir = c.position.vsub(f); dir.y = 0;
          if (dir.length() > 0.01) dir.normalize();
          dir.y = 0.7;
          c.applyImpulse(dir.scale((k || 500) * 0.055));
          return 0;
        },
      });
    }
    return targets;
  }

  // crew: 'A' | 'B'
  applyInput(roles, data, ROLE, crew) {
    const mech = crew === 'B' ? this.mechB : this.mechA;
    const inp = mech.input;
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
      if (typeof data.aimYaw === 'number') inp.armYawR = data.aimYaw;
      if (typeof data.aimPitch === 'number') inp.armPitchR = data.aimPitch;
    }
    if (roles.includes(ROLE.HEAD)) {
      if (typeof data.fire === 'boolean') inp.fire = data.fire;
      if (typeof data.aimYaw === 'number') inp.headYaw = data.aimYaw;
      if (typeof data.aimPitch === 'number') inp.headPitch = data.aimPitch;
    }
  }

  step() {
    const dt = 1 / PHYSICS_HZ;
    this.tick++;
    if (this.phase === PHASE.WIN) return;

    this.mechA.update(dt, this.targetFor(this.mechA));
    this.mechB.update(dt, this.targetFor(this.mechB));
    this.world.step(dt);

    if (this.mechA.isDead || this.mechB.isDead) {
      this.phase = PHASE.WIN;
      this.winner = this.mechA.isDead ? 'B' : 'A';
      this.events.push({ what: 'duelOver', winner: this.winner });
    }
  }

  get summary() {
    return {
      winner: this.winner,
      hpA: Math.round(this.mechA.hp),
      hpB: Math.round(this.mechB.hp),
      damageA: Math.round(this.mechA.stats.damageDealt),
      damageB: Math.round(this.mechB.stats.damageDealt),
    };
  }

  worldInfo() {
    return { city: this.cityDefs, arenaRadius: ARENA_RADIUS, mode: 'duel', props: this.carDefs };
  }

  snapshot() {
    const snap = {
      tick: this.tick,
      time: Date.now(),
      phase: this.phase,
      mechs: [this.mechA.snapshot(), this.mechB.snapshot()],
      monsters: [],
      props: this.cars.map((c, i) => ({
        id: this.carDefs[i].id,
        p: [r2(c.position.x), r2(c.position.y), r2(c.position.z)],
        q: [r2(c.quaternion.x), r2(c.quaternion.y), r2(c.quaternion.z), r2(c.quaternion.w)],
      })),
      ev: this.events,
    };
    if (this.phase === PHASE.WIN) snap.summary = this.summary;
    this.events = [];
    return snap;
  }
}

function clamp(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }
function r2(n) { return Math.round(n * 100) / 100; }
