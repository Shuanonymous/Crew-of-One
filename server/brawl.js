import * as CANNON from 'cannon-es';
import { Mech } from './mech.js';
import { Monster } from './monsters.js';
import { buildCity, ARENA_RADIUS } from './city.js';
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

    this.mech = new Mech(this.world, 'mech1', { x: 0, y: 8, z: 0 }, '#f5b13d');
    this.monsters = [];
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
    return this.monsters.filter((m) => !m.removed).map((m) => ({
      id: m.id, body: m.body, alive: m.alive, radius: m.radius,
      takeHit: (d, f, k) => {
        const wasAlive = m.alive;
        m.takeHit(d, f, k);
        if (wasAlive && !m.alive) this.onKill(m);
      },
    }));
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
    const total = (recipe.crab || 0) + (recipe.pigeon || 0);
    let i = 0;
    const baseAngle = Math.random() * Math.PI * 2;
    const spawnOne = (type) => {
      const a = baseAngle + (i / total) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const r = ARENA_RADIUS + 6;
      this.monsters.push(new Monster(this.world, type,
        { x: Math.cos(a) * r, z: Math.sin(a) * r }, this.wave));
      i++;
    };
    for (let n = 0; n < (recipe.crab || 0); n++) spawnOne('crab');
    for (let n = 0; n < (recipe.pigeon || 0); n++) spawnOne('pigeon');
    this.events.push({ what: 'waveStart', wave: this.wave, count: total });
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
    for (const m of this.monsters) m.update(dt, mechTarget);
    this.monsters = this.monsters.filter((m) => !m.removed);

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
    return { city: this.cityDefs, arenaRadius: ARENA_RADIUS, mode: 'brawl' };
  }

  snapshot() {
    const snap = {
      tick: this.tick,
      time: Date.now(),
      phase: this.phase,
      phaseT: Math.max(0, Math.round(this.phaseT * 10) / 10),
      wave: this.wave,
      credits: this.credits,
      mechs: [this.mech.snapshot()],
      monsters: this.monsters.map((m) => m.snapshot()),
      ev: this.events,
    };
    if (this.phase === PHASE.DEAD) snap.summary = this.summary;
    this.events = [];
    return snap;
  }
}

function clamp(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }
