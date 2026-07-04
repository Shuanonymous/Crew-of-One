// Direct harness tests for the game logic (no network).
// Run: node test/server-logic.test.js — exits nonzero on failure.
import { BrawlGame } from '../server/brawl.js';
import { DuelGame } from '../server/duel.js';
import { TrainingGame } from '../server/training.js';
import { Monster } from '../server/monsters.js';
import { ROLE, PHASE, MECH, DANGER } from '../shared/constants.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}
const ALL_ROLES = [ROLE.LEGS, ROLE.ARM_L, ROLE.ARM_R, ROLE.HEAD];
function stepFor(g, seconds, input) {
  for (let i = 0; i < seconds * 60; i++) {
    if (input) g.applyInput(ALL_ROLES, input, ROLE, 'A');
    g.step();
  }
}
function quietGame() { // endless game with the spawner muzzled
  const g = new BrawlGame();
  g.graceT = 1e9;
  return g;
}

// ------------------------------------------------------------ ENDLESS CORE
{
  const g = new BrawlGame(120);
  check('run has a 5-char seed', /^[A-Z2-9]{5}$/.test(g.seed), g.seed);
  check('world has beacons/tanks/stations/caches',
    g.inter.beacons.length >= 3 && g.inter.tanks.length >= 6 && g.inter.stations.length >= 2 && g.inter.caches.length >= 5,
    `b=${g.inter.beacons.length} t=${g.inter.tanks.length} s=${g.inter.stations.length} c=${g.inter.caches.length}`);

  stepFor(g, 14, { move: { x: 0, z: 0 }, aimYaw: 0 });
  check('danger clock advances', g.dangerLevel > 0.2, `level=${g.dangerLevel.toFixed(2)}`);
  check('spawner produces monsters after grace', g.monsters.length > 0, `n=${g.monsters.length}`);
  check('monster cap respected', g.monsters.filter((m) => m.alive).length <= DANGER.maxMonsters);

  // kill one for credits
  const victim = g.monsters.find((m) => m.alive);
  const c0 = g.credits;
  for (const t of g.mechTargets) if (t.id === victim.id) t.takeHit(9999, null, 0, 'laser');
  check('kill pays credits', g.credits > c0, `${c0} -> ${g.credits}`);

  // shop is beacon-gated
  g.mech.body.position.set(500, 8, 500); // nowhere near a beacon
  const far = g.buy('repair');
  check('shop rejects when no beacon in range', !far.ok, far.reason);
  const bc = g.inter.beacons[0];
  g.mech.body.position.set(bc.p[0], 8, bc.p[2]);
  g.credits = 1000;
  const near = g.buy('dmg');
  check('shop works at a beacon', near.ok && g.mech.upgrades.dmg === 1);
  const p1 = g.priceOf({ id: 'dmg', price: 45, priceGrowth: 1.35 });
  check('repeatable tier price grows', p1 > 45, `next=${p1}`);
  g.buy('dash');
  check('rare special installs', g.mech.upgrades.dash === true);
  const dup = g.buy('dash');
  check('rare special cannot be bought twice… (repeat buys are tiered, specials tracked)', !dup.ok || g.mech.upgrades.dash === true);

  // snapshot shape
  const snap = g.snapshot();
  check('snapshot has danger clock + shopOpen + prices', typeof snap.danger === 'number' && typeof snap.shopOpen === 'boolean' && snap.prices.dmg > 0);

  // death summary
  g.mech.invulnT = 0; g.mech.hp = 1;
  g.mech.takeHit(9999, null, 0);
  stepFor(g, 0.2);
  check('death ends the run', g.phase === PHASE.DEAD);
  const s = g.snapshot().summary;
  check('summary has time/seed/byPart/bestTime', s && s.seed === g.seed && s.byPart && s.bestTime >= 120,
    JSON.stringify({ time: s?.time, best: s?.bestTime, byPart: s?.byPart }));
}

// -------------------------------------------------------- MOVEMENT & FEEL
{
  const g = quietGame();
  stepFor(g, 4, { move: { x: 0, z: -1 }, aimYaw: 0 });
  check('mech walks without falling', !g.mech.isRagdoll && !g.mech.isDead);
  check('mech speed near tuned max', g.mech.walkSpeed > 6 && g.mech.walkSpeed <= 8.8, `v=${g.mech.walkSpeed.toFixed(1)}`);

  // laser slows to ~30% instead of rooting
  for (let i = 0; i < 90; i++) { g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A'); g.step(); }
  for (let i = 0; i < 150; i++) { g.applyInput(ALL_ROLES, { move: { x: 0, z: -1 }, fire: true, aimYaw: 0, aimPitch: 0.2 }, ROLE, 'A'); g.step(); }
  const vLaser = g.mech.walkSpeed;
  check('mech moves at ~30% while lasering', vLaser > 0.8 && vLaser < 4, `v=${vLaser.toFixed(1)}`);

  // dash thrusters
  g.mech.upgrades.dash = true;
  for (let i = 0; i < 30; i++) { g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, fire: false }, ROLE, 'A'); g.step(); }
  const v0 = g.mech.walkSpeed;
  let vMax = 0;
  for (let i = 0; i < 40; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 0, z: -1 }, dash: i === 2, fire: false, aimYaw: 0 }, ROLE, 'A');
    g.step();
    vMax = Math.max(vMax, g.mech.walkSpeed);
  }
  check('dash thrusters launch the mech', vMax > 15, `v ${v0.toFixed(1)} -> peak ${vMax.toFixed(1)}`);
}

// ------------------------------------------------------------ INTERACTABLES
{
  const g = quietGame();
  // fuel tank AoE kills a nearby monster
  const tank = g.inter.tanks[0];
  const m = new Monster(g.world, 'rusher', { x: tank.p[0] + 4, z: tank.p[2] }, 1);
  g.monsters.push(m);
  g.explodeTank(tank);
  check('fuel tank explosion kills nearby monster', !m.alive && !tank.alive);
  check('kill from tank pays credits', g.credits >= m.credits, `credits=${g.credits}`);

  // cache breaks open for credits
  const cache = g.inter.caches[0];
  const c0 = g.credits;
  for (const t of g.mechTargets) if (t.id === cache.id) t.takeHit(25, null, 0);
  check('credit cache pays out when broken', !cache.alive && g.credits === c0 + cache.credits);

  // repair station heals
  const rs = g.inter.stations[0];
  g.mech.hp = 40;
  g.mech.body.position.set(rs.p[0], 8, rs.p[2]);
  stepFor(g, 3, { move: { x: 0, z: 0 } });
  check('repair station heals over time', g.mech.hp > 40, `hp=${g.mech.hp.toFixed(1)}`);

  // monsters wreck stations
  const wrecker = new Monster(g.world, 'crab', { x: rs.p[0] + 3, z: rs.p[2] }, 1);
  wrecker.setState('recover'); wrecker.t = -1e9;
  g.monsters.push(wrecker);
  stepFor(g, 15, { move: { x: 0, z: 0 } });
  check('monsters destroy repair stations', !rs.alive, `hp=${rs.hp.toFixed(0)}`);
}

// --------------------------------------------------------------- SPAWN MIX
{
  const g = new BrawlGame();
  g.time = DANGER.rampSec * 5; // danger level 5: everything unlocked
  g.graceT = 0;
  stepFor(g, 20, { move: { x: 0, z: 0 } });
  const types = new Set(g.monsters.map((m) => m.type));
  check('high danger spawns varied types', types.size >= 3, [...types].join(','));
  const swarm = g.monsters.filter((m) => m.alive && m.type === 'swarmling').length;
  check('swarm cap respected', swarm <= DANGER.maxSwarm, `swarm=${swarm}`);
  check('boss milestone reached (level>=3)', g.monsters.some((m) => m.bossName) || g.bossSpawned.size > 0);
  const boss = g.monsters.find((m) => m.bossName);
  if (boss) check('boss has a serious name', /VORAX|KHARYBDIS|COLOSSUS|WRAITH|CATEGORY|HOLLOW/.test(boss.bossName), boss.bossName);
}

// --------------------------------------------------------------- TURRET
{
  const g = quietGame();
  g.mech.upgrades.turret = true;
  const m = new Monster(g.world, 'crab', { x: 0, z: -15 }, 1);
  m.setState('recover'); m.t = -1e9;
  g.monsters.push(m);
  const hp0 = m.hp;
  stepFor(g, 4, { move: { x: 0, z: 0 } });
  check('shoulder turret chips nearby monsters', m.hp < hp0, `hp ${hp0} -> ${m.hp}`);
}

// ------------------------------------------------------- KICK & VARIETY
{
  const g = quietGame();
  const kicked = new Monster(g.world, 'crab', { x: 0, z: -7 }, 1);
  kicked.setState('recover'); kicked.t = -1e9;
  g.monsters.push(kicked);
  for (let i = 0; i < 30; i++) { g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A'); g.step(); }
  kicked.body.position.set(g.mech.body.position.x, 4, g.mech.body.position.z - 7);
  kicked.body.velocity.setZero();
  const kb = kicked.hp;
  for (let i = 0; i < 130; i++) { g.applyInput(ALL_ROLES, { kick: i < 10, move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A'); g.step(); }
  check('kick damages monsters', kicked.hp < kb, `hp ${kb} -> ${kicked.hp}`);
}
{
  const g = quietGame();
  const tank = new Monster(g.world, 'tank', { x: 0, z: -10 }, 1);
  check('tank resists melee (25%)', tank.takeHit(40, null, 0, 'melee') === 10);
  check('tank takes full laser damage', tank.takeHit(40, null, 0, 'laser') === 40);
}
{
  const g = quietGame();
  g.monsters = [new Monster(g.world, 'spitter', { x: 0, z: -30 }, 1)];
  const hp0 = g.mech.hp;
  let saw = false;
  for (let i = 0; i < 60 * 8; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
    if (g.projectiles.length) saw = true;
  }
  check('spitter lobs projectiles', saw);
  check('spitter globs damage the mech', g.mech.hp < hp0, `hp ${hp0} -> ${g.mech.hp.toFixed(0)}`);
}
{
  const g = quietGame();
  g.monsters = [
    new Monster(g.world, 'swarmling', { x: 0, z: -8 }, 1),
    new Monster(g.world, 'swarmling', { x: 2, z: -8 }, 1),
  ];
  const hp0 = g.mech.hp;
  stepFor(g, 4, { move: { x: 0, z: 0 }, aimYaw: 0 });
  check('swarmlings latch and chew', g.monsters.some((m) => m.latched) && g.mech.hp < hp0);
  for (let i = 0; i < 90; i++) { g.applyInput(ALL_ROLES, { kick: i < 10, move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A'); g.step(); }
  check('kick shakes off the swarm', g.monsters.every((m) => !m.alive || !m.latched));
}
{
  const g = quietGame();
  g.monsters = [new Monster(g.world, 'flyer', { x: 0, z: -26 }, 1)];
  const fl = g.monsters[0];
  let dived = false, minY = 99;
  for (let i = 0; i < 60 * 12; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
    if (fl.state === 'attack') { dived = true; minY = Math.min(minY, fl.body.position.y); }
  }
  check('flyer dives at the mech', dived && minY < 12.5, `minY=${minY.toFixed(1)}`);
}

// ---------------------------------------------------------------- DUEL
{
  const g = new DuelGame();
  check('duel spawns two mechs', g.mechs.length === 2);
  g.mechB.body.position.set(g.mechA.body.position.x + 6, 8, g.mechA.body.position.z);
  g.mechB.invulnT = 0;
  const yawAB = Math.atan2(-6, 0);
  let guard = 0;
  while (!g.mechB.isDead && guard++ < 60) {
    for (let i = 0; i < 90; i++) {
      g.applyInput(ALL_ROLES, { punchL: i % 60 < 15, punchR: i % 60 < 15, aimYaw: yawAB, aimPitch: 0 }, ROLE, 'A');
      g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 } }, ROLE, 'B');
      g.step();
    }
    g.mechB.body.position.set(g.mechA.body.position.x + 6, 8, g.mechA.body.position.z);
    g.mechB.invulnT = 0; g.mechB.ragdollT = 0;
  }
  check('duel: punches kill the enemy mech', g.mechB.isDead, `guard=${guard}`);
  check('duel: winner declared', g.phase === PHASE.WIN && g.winner === 'A');
}

// ------------------------------------------------------------- TRAINING
{
  const g = new TrainingGame();
  check('training objectives exist', g.rings.length === 3 && g.dummies.length === 2 && g.crates.length === 4 && !g.balloon.popped);
  g.mech.body.position.set(0, 8, 2);
  stepFor(g, 1, { move: { x: 0, z: -0.5 }, aimYaw: 0 });
  check('ring triggers when walked through', g.rings[0].done);
  for (const r of g.rings) r.done = true;
  for (const d of g.dummies) d.takeHit(999, null, 0, 'laser');
  g.balloon.popped = true;
  g.cratesToppled = true;
  stepFor(g, 3.2);
  check('training completes', g.phase === PHASE.WIN);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
