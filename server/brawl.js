import * as CANNON from 'cannon-es';
import { Mech } from './mech.js';
import { Monster } from './monsters.js';
import { buildCity, buildCars, ARENA_RADIUS } from './city.js';
import { PHYSICS_HZ, PHASE, SHOP, SHOP_TIME, MONSTERS, waveRecipe } from '../shared/constants.js';

// KAIJU BRAWL — the main mode. One crew, one mech, escalating waves of
// goofy monsters, credits, and a shop full of bad ideas between waves.

export class BrawlGame {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.5;
    this.world.defaultContactMaterial.restitution = 0.1;

    const city = buildCity(this.world);
    this.cityDefs = city.defs;
    const cars = buildCars(this.world);
    this.cars = cars.bodies;
    this.carDefs = cars.defs;

    this.mech = new Mech(this.world, 'mech1', { x: 0, y: 8, z: 0 }, '#f5b13d');
    this.monsters = [];
    this.projectiles = [];
    this.nextProjId = 1;
    this.wave = 0;
    this.credits = 0;
    this.creditsEarned = 0;
    this.kills = 0;
    this.phase = PHASE.SHOP;      // brief pre-wave-1 "shop" = get ready screen
    this.phaseT = 6;              // countdown to wave 1
    this.tick = 0;
    this.events = [];             // game-level events (waveStart, kill, buy...)
    this.purchases = [];
  }

  get mechs() { return [this.mech]; }

  // targets the mech's fists/laser can hit
  get mechTargets() {
    const targets = this.monsters.filter((m) => !m.removed).map((m) => ({
      id: m.id, body: m.body, alive: m.alive, radius: m.radius,
      takeHit: (d, f, k, kind) => {
        const wasAlive = m.alive;
        const dealt = m.takeHit(d, f, k, kind);
        if (wasAlive && !m.alive) this.onKill(m);
        return dealt;
      },
    }));
    // cars: 0 hp, pure physics comedy — punt them into things
    for (const c of this.cars) {
      targets.push({
        id: 'car', body: c, alive: true, radius: 1.8,
        takeHit: (d, f, k) => {
          if (!f) return 0;
          const dir = c.position.vsub(f); dir.y = 0;
          if (dir.length() > 0.01) dir.normalize();
          dir.y = 0.7;
          c.applyImpulse(dir.scale((k || 500) * 0.055));
          this.events.push({ what: 'carHit', p: [c.position.x, c.position.y, c.position.z] });
          return 0;
        },
      });
    }
    return targets;
  }

  onKill(m) {
    this.kills++;
    this.credits += m.credits;
    this.creditsEarned += m.credits;
    this.events.push({ what: 'kill', type: m.type, credits: m.credits });
  }

  startWave() {
    this.wave++;
    this.phase = PHASE.FIGHT;
    const recipe = waveRecipe(this.wave);
    const total = Object.values(recipe).reduce((s, n) => s + (n || 0), 0);
    let i = 0;
    const baseAngle = Math.random() * Math.PI * 2;
    const spawnOne = (type, jitter = 0.5) => {
      const a = baseAngle + (i / Math.max(1, total)) * Math.PI * 2 + (Math.random() - 0.5) * jitter;
      const r = ARENA_RADIUS + 6;
      const m = new Monster(this.world, type, { x: Math.cos(a) * r, z: Math.sin(a) * r }, this.wave);
      this.monsters.push(m);
      i++;
      return m;
    };
    let boss = null;
    for (const [type, count] of Object.entries(recipe)) {
      for (let n = 0; n < (count || 0); n++) {
        const m = spawnOne(type, type === 'swarmling' ? 0.15 : 0.5);
        if (type === 'boss') boss = m;
      }
    }
    this.events.push({ what: 'waveStart', wave: this.wave, count: total, boss: boss?.bossName || null });
  }

  spawnMinions(boss, count) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      this.monsters.push(new Monster(this.world, 'rusher', {
        x: boss.body.position.x + Math.cos(a) * 9,
        z: boss.body.position.z + Math.sin(a) * 9,
      }, this.wave));
    }
  }

  buy(itemId) {
    if (this.phase !== PHASE.SHOP) return { ok: false, reason: 'shop is closed' };
    const item = SHOP.find((s) => s.id === itemId);
    if (!item) return { ok: false, reason: 'no such thing' };
    if (!item.repeat && this.mech.upgrades[itemId]) return { ok: false, reason: 'already owned' };
    if (this.credits < item.price) return { ok: false, reason: 'not enough credits' };
    this.credits -= item.price;
    if (itemId === 'repair') this.mech.heal(45);
    else this.mech.upgrades[itemId] = true;
    this.purchases.push(item.name);
    this.events.push({ what: 'buy', item: item.name });
    return { ok: true };
  }

  // host can skip the shop wait
  shopDone() {
    if (this.phase === PHASE.SHOP) this.phaseT = Math.min(this.phaseT, 1.5);
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

    if (this.phase === PHASE.DEAD) return;

    this.mech.update(dt, this.mechTargets);

    const mechTarget = {
      body: this.mech.body,
      isRagdoll: this.mech.isRagdoll,
      takeHit: (d, f, k) => this.mech.takeHit(d, f, k),
    };
    for (const m of this.monsters) {
      m.update(dt, mechTarget);
      if (m.pendingProjectile) {
        this.projectiles.push({ id: 'pj' + this.nextProjId++, t: 0, ...m.pendingProjectile });
        m.pendingProjectile = null;
      }
      if (m.pendingSummon) {
        this.spawnMinions(m, m.pendingSummon);
        m.pendingSummon = 0;
      }
    }
    this.monsters = this.monsters.filter((m) => !m.removed);

    // spitter globs: arcing projectiles the LEGS player can sidestep
    for (const pj of this.projectiles) {
      pj.t += dt;
      pj.v.y -= 20 * dt;
      pj.p.vadd(pj.v.scale(dt, new CANNON.Vec3()), pj.p);
      const d = pj.p.distanceTo(this.mech.body.position);
      if (d < pj.radius + 3.2) {
        this.mech.takeHit(pj.damage, pj.p, 900);
        this.events.push({ what: 'splat', p: [pj.p.x, pj.p.y, pj.p.z], hit: true });
        pj.t = 99;
      } else if (pj.p.y < 0.3) {
        this.events.push({ what: 'splat', p: [pj.p.x, 0.3, pj.p.z], hit: false });
        pj.t = 99;
      }
    }
    this.projectiles = this.projectiles.filter((pj) => pj.t < 6);

    this.world.step(dt);

    if (this.mech.isDead && this.phase !== PHASE.DEAD) {
      this.phase = PHASE.DEAD;
      this.events.push({ what: 'runOver', wave: this.wave });
      return;
    }

    if (this.phase === PHASE.FIGHT) {
      if (this.monsters.every((m) => !m.alive) && this.monsters.every((m) => m.deadT > 1.2 || m.removed)) {
        this.phase = PHASE.SHOP;
        this.phaseT = SHOP_TIME;
        this.events.push({ what: 'waveClear', wave: this.wave });
      }
    } else if (this.phase === PHASE.SHOP) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startWave();
    }
  }

  get summary() {
    return {
      wave: this.wave,
      kills: this.kills,
      creditsEarned: this.creditsEarned,
      damageDealt: Math.round(this.mech.stats.damageDealt),
      punches: this.mech.stats.punches,
      kicks: this.mech.stats.kicks,
      lasers: this.mech.stats.lasers,
      falls: this.mech.stats.falls,
      purchases: this.purchases,
    };
  }

  worldInfo() {
    return { city: this.cityDefs, arenaRadius: ARENA_RADIUS, mode: 'brawl', props: this.carDefs };
  }

  snapshot() {
    const bossMon = this.monsters.find((m) => m.bossName && m.alive);
    const snap = {
      tick: this.tick,
      time: Date.now(),
      phase: this.phase,
      phaseT: Math.max(0, Math.round(this.phaseT * 10) / 10),
      wave: this.wave,
      credits: this.credits,
      mechs: [this.mech.snapshot()],
      monsters: this.monsters.map((m) => m.snapshot()),
      projs: this.projectiles.map((pj) => ({ id: pj.id, p: [r2(pj.p.x), r2(pj.p.y), r2(pj.p.z)] })),
      props: this.cars.map((c, i) => ({
        id: this.carDefs[i].id,
        p: [r2(c.position.x), r2(c.position.y), r2(c.position.z)],
        q: [r2(c.quaternion.x), r2(c.quaternion.y), r2(c.quaternion.z), r2(c.quaternion.w)],
      })),
      ev: this.events,
    };
    if (bossMon) snap.bossBar = { name: bossMon.bossName, hp: Math.round(bossMon.hp), maxHp: bossMon.maxHp };
    if (this.phase === PHASE.DEAD) snap.summary = this.summary;
    this.events = [];
    return snap;
  }
}

function clamp(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }
function r2(n) { return Math.round(n * 100) / 100; }
