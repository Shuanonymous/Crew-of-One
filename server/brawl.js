import * as CANNON from 'cannon-es';
import { Mech } from './mech.js';
import { Monster } from './monsters.js';
import { buildCity, buildCars, makeSeed, WORLD_HALF } from './city.js';
import { PHYSICS_HZ, PHASE, SHOP, DANGER, BEACON_RADIUS } from '../shared/constants.js';

// ENDLESS RUN — the danger clock rises forever; the run ends when the
// mech falls. Credits drop constantly; spending happens at supply
// beacons out in the district. Risk-of-Rain pacing, kaiju-film tone.

export class BrawlGame {
  constructor(bestTime = 0) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.5;
    this.world.defaultContactMaterial.restitution = 0.1;

    this.seed = makeSeed();
    const city = buildCity(this.world, this.seed);
    this.cityDefs = city.defs;
    this.inter = city.interactables;
    const cars = buildCars(this.world);
    this.cars = cars.bodies;
    this.carDefs = cars.defs;

    this.mech = new Mech(this.world, 'mech1', { x: 0, y: 8, z: 0 }, '#8a93a6');
    this.monsters = [];
    this.projectiles = [];
    this.pickups = [];        // credit drops: { id, p, value, t }
    this.nextId = 1;

    this.time = 0;            // seconds survived — THE danger clock
    this.spawnPoints = 0;     // spawner wallet
    this.graceT = 8;          // a breath before the first spawns
    this.bossSpawned = new Set();
    this.credits = 0;
    this.creditsEarned = 0;
    this.kills = 0;
    this.buyCounts = {};      // shop tier pricing
    this.bestTime = bestTime;
    this.phase = PHASE.FIGHT;
    this.tick = 0;
    this.events = [{ what: 'runStart', seed: this.seed }];
    this.purchases = [];
  }

  get mechs() { return [this.mech]; }
  get dangerLevel() { return this.time / DANGER.rampSec; }

  // ------------------------------------------------------------- targets
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
    // interactables the mech can hit: fuel tanks + credit caches
    for (const t of this.inter.tanks) {
      if (!t.alive) continue;
      targets.push({
        id: t.id, body: { position: new CANNON.Vec3(...t.p) }, alive: true, radius: 2.5,
        takeHit: () => { this.explodeTank(t); return 0; },
      });
    }
    for (const cc of this.inter.caches) {
      if (!cc.alive) continue;
      targets.push({
        id: cc.id, body: { position: new CANNON.Vec3(...cc.p) }, alive: true, radius: 2.2,
        takeHit: (d) => {
          cc.hp -= d;
          if (cc.hp <= 0) {
            cc.alive = false;
            this.credits += cc.credits;
            this.creditsEarned += cc.credits;
            this.events.push({ what: 'cacheOpen', p: cc.p, credits: cc.credits });
          }
          return 0;
        },
      });
    }
    return targets;
  }

  explodeTank(t) {
    if (!t.alive) return;
    t.alive = false;
    const p = new CANNON.Vec3(...t.p);
    this.events.push({ what: 'tankBoom', p: t.p });
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = m.body.position.distanceTo(p);
      if (d < 14) {
        const wasAlive = m.alive;
        m.takeHit(45, p, 2200, 'laser'); // full damage even to tanks
        if (wasAlive && !m.alive) this.onKill(m);
      }
    }
    if (this.mech.body.position.distanceTo(p) < 12) this.mech.takeHit(18, p, 1600);
  }

  onKill(m) {
    this.kills++;
    this.credits += m.credits;
    this.creditsEarned += m.credits;
    this.events.push({ what: 'kill', type: m.type, credits: m.credits });
    // extra pickup drops keep the economy flowing
    if (Math.random() < 0.35) {
      const p = m.body.position;
      this.pickups.push({ id: 'pk' + this.nextId++, p: [r2(p.x), 1.2, r2(p.z)], value: 5 + Math.floor(Math.random() * 11), t: 0 });
    }
  }

  // ------------------------------------------------------------- spawner
  stepSpawner(dt) {
    if (this.graceT > 0) { this.graceT -= dt; return; }
    const level = this.dangerLevel;
    this.spawnPoints += (DANGER.spawnBase + DANGER.spawnScale * level) * dt;

    // boss milestones
    for (const at of DANGER.bossAtLevels) {
      if (level >= at && !this.bossSpawned.has(at)) {
        this.bossSpawned.add(at);
        const m = this.spawnMonster('boss');
        if (m) this.events.push({ what: 'bossArrives', name: m.bossName });
      }
    }

    const alive = this.monsters.filter((m) => m.alive);
    if (alive.length >= DANGER.maxMonsters) return;
    // spend points on the most expensive affordable unlocked type (variety via shuffle)
    const types = Object.keys(DANGER.costs).filter((t) => DANGER.unlocks[t] <= level);
    for (let guard = 0; guard < 6 && this.spawnPoints > 4; guard++) {
      const pick = types[Math.floor(Math.random() * types.length)];
      const cost = DANGER.costs[pick];
      if (this.spawnPoints < cost) continue;
      if (pick === 'swarmling') {
        const swarmAlive = alive.filter((m) => m.type === 'swarmling').length;
        if (swarmAlive >= DANGER.maxSwarm) continue;
        // swarms come in handfuls
        const n = Math.min(6, DANGER.maxSwarm - swarmAlive);
        for (let i = 0; i < n && this.spawnPoints >= cost; i++) {
          this.spawnMonster('swarmling');
          this.spawnPoints -= cost;
        }
      } else {
        this.spawnMonster(pick);
        this.spawnPoints -= cost;
      }
      if (this.monsters.filter((m) => m.alive).length >= DANGER.maxMonsters) break;
    }
  }

  spawnMonster(type) {
    const mp = this.mech.body.position;
    const a = Math.random() * Math.PI * 2;
    const r = 55 + Math.random() * 25;
    const x = clampW(mp.x + Math.cos(a) * r), z = clampW(mp.z + Math.sin(a) * r);
    const level = Math.max(1, Math.ceil(this.dangerLevel + 1));
    const m = new Monster(this.world, type, { x, z }, level);
    this.monsters.push(m);
    return m;
  }

  // ---------------------------------------------------------------- shop
  get nearBeacon() {
    const mp = this.mech.body.position;
    return this.inter.beacons.find((b) => Math.hypot(b.p[0] - mp.x, b.p[2] - mp.z) < BEACON_RADIUS) || null;
  }

  priceOf(item) {
    const count = this.buyCounts[item.id] || 0;
    return Math.round(item.price * Math.pow(item.priceGrowth || 1, count));
  }

  buy(itemId) {
    if (!this.nearBeacon) return { ok: false, reason: 'no supply beacon in range' };
    const item = SHOP.find((s) => s.id === itemId);
    if (!item) return { ok: false, reason: 'unknown item' };
    const up = this.mech.upgrades;
    const owned = !item.repeat && !(item.priceGrowth) && up[itemId] === true;
    if (owned) return { ok: false, reason: 'already installed' };
    const price = this.priceOf(item);
    if (this.credits < price) return { ok: false, reason: 'insufficient credits' };
    this.credits -= price;
    this.buyCounts[itemId] = (this.buyCounts[itemId] || 0) + 1;
    if (itemId === 'repair') this.mech.heal(50);
    else if (typeof up[itemId] === 'number') up[itemId]++;
    else up[itemId] = true;
    this.purchases.push(item.name);
    this.events.push({ what: 'buy', item: item.name });
    return { ok: true };
  }

  shopDone() {} // legacy no-op (endless shop is proximity-based)

  applyInput(roles, data, ROLE) {
    const inp = this.mech.input;
    if (roles.includes(ROLE.LEGS)) {
      if (data.move) { inp.move.x = clamp(data.move.x); inp.move.z = clamp(data.move.z); }
      if (typeof data.kick === 'boolean') inp.kick = data.kick;
      if (typeof data.dash === 'boolean') inp.dash = data.dash;
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
    this.time += dt;

    this.stepSpawner(dt);
    this.mech.update(dt, this.mechTargets);

    const mechTarget = {
      body: this.mech.body,
      isRagdoll: this.mech.isRagdoll,
      takeHit: (d, f, k) => this.mech.takeHit(d, f, k),
    };
    for (const m of this.monsters) {
      m.update(dt, mechTarget);
      if (m.pendingProjectile) {
        this.projectiles.push({ id: 'pj' + this.nextId++, t: 0, ...m.pendingProjectile });
        m.pendingProjectile = null;
      }
      if (m.pendingSummon) {
        for (let i = 0; i < m.pendingSummon; i++) this.spawnMonster('rusher');
        m.pendingSummon = 0;
      }
    }
    this.monsters = this.monsters.filter((m) => !m.removed);

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

    // credit pickups: hoover them by walking near
    const mp = this.mech.body.position;
    for (const pk of this.pickups) {
      pk.t += dt;
      if (Math.hypot(pk.p[0] - mp.x, pk.p[2] - mp.z) < 6) {
        this.credits += pk.value;
        this.creditsEarned += pk.value;
        this.events.push({ what: 'pickup', value: pk.value });
        pk.t = 999;
      }
    }
    this.pickups = this.pickups.filter((pk) => pk.t < 45);

    // repair stations: heal while inside; nearby monsters wreck them
    for (const rs of this.inter.stations) {
      if (!rs.alive) continue;
      if (Math.hypot(rs.p[0] - mp.x, rs.p[2] - mp.z) < 10 && this.mech.hp < this.mech.maxHp) {
        this.mech.heal(5 * dt);
        if (this.tick % 60 === 0) this.events.push({ what: 'healing' });
      }
      for (const m of this.monsters) {
        if (m.alive && m.behavior !== 'swarm' && m.body.position.distanceTo(new CANNON.Vec3(...rs.p)) < 9) {
          rs.hp -= 6 * dt;
          if (rs.hp <= 0) { rs.alive = false; this.events.push({ what: 'stationDown', p: rs.p }); }
          break;
        }
      }
    }

    this.world.step(dt);

    if (this.mech.isDead && this.phase !== PHASE.DEAD) {
      this.phase = PHASE.DEAD;
      this.events.push({ what: 'runOver', time: Math.round(this.time) });
    }
  }

  get summary() {
    const s = this.mech.stats;
    return {
      time: Math.round(this.time),
      bestTime: Math.max(this.bestTime, Math.round(this.time)),
      newBest: Math.round(this.time) > this.bestTime,
      seed: this.seed,
      kills: this.kills,
      creditsEarned: this.creditsEarned,
      damageDealt: Math.round(s.damageDealt),
      byPart: Object.fromEntries(Object.entries(s.byPart).map(([k, v]) => [k, Math.round(v)])),
      falls: s.falls,
      purchases: this.purchases,
      dangerLevel: Math.floor(this.dangerLevel),
    };
  }

  worldInfo() {
    return {
      city: this.cityDefs, mode: 'brawl', seed: this.seed, props: this.carDefs,
      beacons: this.inter.beacons, tanks: this.inter.tanks.map((t) => ({ id: t.id, p: t.p })),
      stations: this.inter.stations.map((s) => ({ id: s.id, p: s.p })),
      caches: this.inter.caches.map((c) => ({ id: c.id, p: c.p })),
      worldHalf: WORLD_HALF,
    };
  }

  snapshot() {
    const bossMon = this.monsters.find((m) => m.bossName && m.alive);
    const snap = {
      tick: this.tick,
      time: Date.now(),
      phase: this.phase,
      runTime: Math.round(this.time * 10) / 10,
      danger: Math.round(this.dangerLevel * 100) / 100,
      credits: this.credits,
      shopOpen: !!this.nearBeacon,
      beaconId: this.nearBeacon?.id || null,
      prices: Object.fromEntries(SHOP.map((it) => [it.id, this.priceOf(it)])),
      mechs: [this.mech.snapshot()],
      monsters: this.monsters.map((m) => m.snapshot()),
      projs: this.projectiles.map((pj) => ({ id: pj.id, p: [r2(pj.p.x), r2(pj.p.y), r2(pj.p.z)] })),
      pickups: this.pickups.map((pk) => ({ id: pk.id, p: pk.p, v: pk.value })),
      inter: {
        tanks: this.inter.tanks.map((t) => t.alive),
        stations: this.inter.stations.map((s) => ({ alive: s.alive, hp: Math.max(0, Math.round(s.hp)) })),
        caches: this.inter.caches.map((c) => c.alive),
      },
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
function clampW(n) { return Math.max(-WORLD_HALF + 10, Math.min(WORLD_HALF - 10, n)); }
function r2(n) { return Math.round(n * 100) / 100; }
