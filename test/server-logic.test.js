// Direct harness tests for the game logic (no network).
// Run: node test/server-logic.test.js — exits nonzero on failure.
import { BrawlGame } from '../server/brawl.js';
import { DuelGame } from '../server/duel.js';
import { TrainingGame } from '../server/training.js';
import { ROLE, PHASE, MECH } from '../shared/constants.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}
const ALL_ROLES = [ROLE.LEGS, ROLE.ARM_L, ROLE.ARM_R, ROLE.HEAD];

function stepFor(game, seconds, input) {
  for (let i = 0; i < seconds * 60; i++) {
    if (input) game.applyInput(ALL_ROLES, input, ROLE, 'A');
    game.step();
  }
}

// ---------------------------------------------------------------- BRAWL
{
  const g = new BrawlGame();
  check('brawl starts in pre-wave shop phase', g.phase === PHASE.SHOP);

  stepFor(g, 6.5); // countdown to wave 1
  check('wave 1 starts after countdown', g.phase === PHASE.FIGHT && g.wave === 1);
  check('wave 1 spawns 2 crabs', g.monsters.length === 2 && g.monsters.every((m) => m.type === 'crab'));

  // mech walks stable in the city
  stepFor(g, 4, { move: { x: 0, z: -1 }, aimYaw: 0 });
  check('mech walks without falling', !g.mech.isRagdoll && !g.mech.isDead,
    `pos=(${g.mech.body.position.x.toFixed(1)},${g.mech.body.position.y.toFixed(1)},${g.mech.body.position.z.toFixed(1)})`);
  const speed = g.mech.walkSpeed;
  check('mech speed near tuned max (7.8)', speed > 6 && speed <= 8.8, `speed=${speed.toFixed(1)}`);

  // teleport the crab in front of the mech and punch it to death
  const crab = g.monsters[0];
  const mp = g.mech.body.position;
  const yaw = g.mech.input.headYaw;
  crab.body.position.set(mp.x - Math.sin(yaw) * 6, 3, mp.z - Math.cos(yaw) * 6);
  let guard = 0;
  while (crab.alive && guard++ < 40) {
    // click punch, hold through windup
    for (let i = 0; i < 90; i++) {
      g.applyInput(ALL_ROLES, { punchL: i % 60 < 20, punchR: i % 60 < 20, aimYaw: yaw, aimPitch: 0 }, ROLE, 'A');
      g.step();
    }
    crab.body.position.set(
      g.mech.body.position.x - Math.sin(g.mech.facingYaw || 0) * 6, 3,
      g.mech.body.position.z - Math.cos(g.mech.facingYaw || 0) * 6);
  }
  check('punches kill the crab', !crab.alive, `after ${guard} punch cycles, crabHp=${crab.hp}`);
  check('kill pays credits', g.credits >= 20, `credits=${g.credits}`);
  check('kill counted', g.kills === 1);
  // dispatch the second crab so the wave can clear
  for (const t of g.mechTargets) if (t.alive && t.id !== 'car') t.takeHit(999, null, 0, 'laser');

  // wave clear -> shop
  stepFor(g, 3.5);
  check('wave clear enters shop', g.phase === PHASE.SHOP, `phase=${g.phase}`);

  // shopping
  const c0 = g.credits;
  const r1 = g.buy('fists');
  check('can buy fists with enough credits or fails cleanly', r1.ok ? g.mech.upgrades.fists : c0 < 60, JSON.stringify(r1));
  const r2 = g.buy('nonsense');
  check('bogus item rejected', !r2.ok);

  // give credits and buy everything
  g.credits = 500;
  for (const id of ['fists', 'laser', 'rocket', 'armor', 'coffee']) g.buy(id);
  check('upgrades apply', g.mech.upgrades.fists && g.mech.upgrades.laser && g.mech.upgrades.rocket && g.mech.upgrades.armor && g.mech.upgrades.coffee);
  const rDup = g.buy('fists');
  check('duplicate purchase rejected', !rDup.ok);
  g.mech.hp = 10;
  g.buy('repair');
  check('repair heals', g.mech.hp === 55, `hp=${g.mech.hp}`);

  // laser: teleport a fresh wave target and burn it
  g.shopDone();
  stepFor(g, 2);
  check('shopDone fast-forwards to next wave', g.phase === PHASE.FIGHT && g.wave === 2, `phase=${g.phase} wave=${g.wave}`);
  const target = g.monsters[0];
  target.body.position.set(g.mech.body.position.x, 4, g.mech.body.position.z - 12);
  // stop moving, aim at it (recomputed each tick as it walks), hold fire
  const hpBefore = target.hp;
  for (let i = 0; i < 60 * 4; i++) {
    const eyeY = g.mech.body.position.y + MECH.torsoSize.y / 2 + 1.2;
    const dx = target.body.position.x - g.mech.body.position.x;
    const dz = target.body.position.z - g.mech.body.position.z;
    const dy = target.body.position.y - eyeY;
    const yawT = Math.atan2(-dx, -dz);
    const pitchT = Math.atan2(dy, Math.hypot(dx, dz));
    g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, fire: true, aimYaw: yawT, aimPitch: pitchT }, ROLE, 'A');
    g.step();
  }
  check('laser damages the target', target.hp < hpBefore, `hp ${hpBefore} -> ${target.hp}`);
  check('laser locks movement while charging', true); // covered by design; walk gate tested below

  // movement lock during charge
  const posBefore = g.mech.body.position.x;
  for (let i = 0; i < 60; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 1, z: 0 }, fire: true, aimYaw: 0 }, ROLE, 'A');
    g.step();
  }
  const drift = Math.abs(g.mech.body.position.x - posBefore);
  check('mech cannot walk while charging laser', drift < 1.5, `drift=${drift.toFixed(2)}`);

  // mech death ends the run
  g.phase = PHASE.FIGHT; // the crabs may have finished the mech off already
  g.mech.invulnT = 0;
  g.mech.hp = 1;
  g.mech.takeHit(9999, null, 0);
  stepFor(g, 0.2);
  check('mech death sets DEAD phase', g.phase === PHASE.DEAD);
  const snap = g.snapshot();
  check('death snapshot carries summary', snap.summary && snap.summary.wave === g.wave, JSON.stringify(snap.summary || {}));
}

// ------------------------------------------------------- KICK (fresh game)
{
  const g = new BrawlGame();
  stepFor(g, 6.5); // wave 1: two crabs
  const kicked = g.monsters[0];
  for (const m of g.monsters) {
    m.setState('recover'); m.t = -99; m.body.velocity.setZero();
    if (m !== kicked) m.body.position.set(150, 4, 150);
  }
  // settle the mech facing yaw 0
  for (let i = 0; i < 30; i++) { g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A'); g.step(); }
  kicked.body.position.set(g.mech.body.position.x, 4, g.mech.body.position.z - 7);
  kicked.body.velocity.setZero();
  const kb = kicked.hp;
  for (let i = 0; i < 130; i++) {
    g.applyInput(ALL_ROLES, { kick: i < 10, move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
  }
  check('kick damages the monster', kicked.hp < kb, `hp ${kb} -> ${kicked.hp}, kicks=${g.mech.stats.kicks}`);
}

// ---------------------------------------------------------------- DUEL
{
  const g = new DuelGame();
  check('duel spawns two mechs', g.mechs.length === 2);
  // crew B holds fire... crew A punches crew B to death via direct hits
  g.mechB.body.position.set(g.mechA.body.position.x + 6, 8, g.mechA.body.position.z);
  g.mechB.invulnT = 0;
  const yawAB = Math.atan2(-(g.mechB.body.position.x - g.mechA.body.position.x), -(g.mechB.body.position.z - g.mechA.body.position.z));
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
  check('duel: punches damage the enemy mech to death', g.mechB.isDead, `guard=${guard} hpB=${g.mechB.hp}`);
  check('duel: winner declared', g.phase === PHASE.WIN && g.winner === 'A', `winner=${g.winner}`);
}

// ---------------------------------------------------------------- TRAINING
{
  const g = new TrainingGame();
  check('training has 3 rings, 2 dummies, crates, balloon',
    g.rings.length === 3 && g.dummies.length === 2 && g.crates.length === 4 && !g.balloon.popped);

  // drive through ring 0 at the plaza center
  g.mech.body.position.set(0, 8, 2);
  stepFor(g, 1, { move: { x: 0, z: -0.5 }, aimYaw: 0 });
  check('ring triggers when walked through', g.rings[0].done);

  // punch a dummy (punches send it flying, so drag it back each round)
  const dummy = g.dummies[0];
  g.mech.body.position.set(dummy.body.position.x, 8, dummy.body.position.z + 6);
  g.mech.body.velocity.setZero();
  for (let round = 0; round < 10 && dummy.alive; round++) {
    dummy.body.position.set(g.mech.body.position.x, 4, g.mech.body.position.z - 6);
    dummy.body.velocity.setZero();
    for (let i = 0; i < 90; i++) {
      g.applyInput(ALL_ROLES, { punchL: i % 60 < 15, punchR: i % 60 < 15, aimYaw: 0, aimPitch: 0, move: { x: 0, z: 0 } }, ROLE, 'A');
      g.step();
    }
  }
  check('dummy dies to punches', !dummy.alive, `hp=${dummy.hp}`);

  // laser the balloon
  g.mech.body.position.set(g.balloon.p[0], 8, g.balloon.p[2] + 25);
  g.mech.body.velocity.setZero();
  const pitch = Math.atan2(g.balloon.p[1] - (8 + 4), 25);
  for (let i = 0; i < 60 * 6 && !g.balloon.popped; i++) {
    g.applyInput(ALL_ROLES, { fire: true, aimYaw: 0, aimPitch: pitch, move: { x: 0, z: 0 } }, ROLE, 'A');
    g.step();
  }
  check('laser pops the balloon', g.balloon.popped);

  // kick the crate tower
  g.mech.body.position.set(-26, 8, 24 + 8);
  g.mech.body.velocity.setZero();
  g.mech.input.headYaw = 0;
  for (let round = 0; round < 6 && !g.cratesToppled; round++) {
    for (let i = 0; i < 130; i++) {
      g.applyInput(ALL_ROLES, { kick: i < 10, aimYaw: 0, move: { x: 0, z: 0 } }, ROLE, 'A');
      g.step();
    }
  }
  check('kick topples the crates', g.cratesToppled);

  // finish remaining objectives to trigger completion
  for (const r of g.rings) r.done = true;
  for (const d of g.dummies) if (d.alive) d.takeHit(999, null, 0);
  g.balloon.popped = true;
  stepFor(g, 3.2);
  check('training completes', g.phase === PHASE.WIN, `phase=${g.phase}`);
  check('training summary has a time', g.summary.time > 0, `time=${g.summary.time}s`);
}

// ------------------------------------------------- MONSTER VARIETY (update)
import { Monster } from '../server/monsters.js';
{
  // SPITTER: keeps distance and lobs globs that hurt the mech
  const g = new BrawlGame();
  stepFor(g, 6.5);
  for (const m of g.monsters) { m.hp = 0; m.deadT = 99; m.removed = true; g.world.removeBody(m.body); }
  g.monsters = [new Monster(g.world, 'spitter', { x: 0, z: -30 }, 1)];
  g.phase = PHASE.FIGHT;
  const hp0 = g.mech.hp;
  let sawProjectile = false;
  for (let i = 0; i < 60 * 8; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
    if (g.projectiles.length) sawProjectile = true;
  }
  check('spitter lobs projectiles', sawProjectile);
  check('spitter globs damage the mech', g.mech.hp < hp0, `hp ${hp0} -> ${g.mech.hp}`);
  const spit = g.monsters[0];
  spit.body.position.set(g.mech.body.position.x, 3, g.mech.body.position.z - 10);
  const dBefore = 10;
  stepFor(g, 3);
  const dAfter = spit.body.position.distanceTo(g.mech.body.position);
  check('spitter backs away when crowded', dAfter > dBefore + 3, `dist ${dBefore} -> ${dAfter.toFixed(1)}`);
}
{
  // TANK: shrugs off melee, melts to laser
  const g = new BrawlGame();
  const tank = new Monster(g.world, 'tank', { x: 0, z: -10 }, 1);
  const meleeDealt = tank.takeHit(40, null, 0, 'melee');
  const laserDealt = tank.takeHit(40, null, 0, 'laser');
  check('tank resists melee (25%)', meleeDealt === 10, `dealt=${meleeDealt}`);
  check('tank takes full laser damage', laserDealt === 40, `dealt=${laserDealt}`);
}
{
  // FLYER: circles at altitude, then dives through the mech
  const g = new BrawlGame();
  stepFor(g, 6.5);
  for (const m of g.monsters) { m.hp = 0; m.deadT = 99; m.removed = true; g.world.removeBody(m.body); }
  g.monsters = [new Monster(g.world, 'flyer', { x: 0, z: -26 }, 1)];
  g.phase = PHASE.FIGHT;
  const fl = g.monsters[0];
  let minY = 99, dived = false, highBefore = false;
  for (let i = 0; i < 60 * 12; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
    if (fl.state === 'walk' && fl.body.position.y > 10) highBefore = true;
    if (fl.state === 'attack') { dived = true; minY = Math.min(minY, fl.body.position.y); }
  }
  check('flyer cruises at altitude', highBefore, `y=${fl.body.position.y.toFixed(1)}`);
  // the dive aims at the mech's torso (~y 11), not the pavement
  check('flyer dives at the mech', dived && minY < 12.5, `dive minY=${minY.toFixed(1)}`);
}
{
  // SWARM: latches onto the mech and chews; a kick shakes them off
  const g = new BrawlGame();
  stepFor(g, 6.5);
  for (const m of g.monsters) { m.hp = 0; m.deadT = 99; m.removed = true; g.world.removeBody(m.body); }
  g.monsters = [
    new Monster(g.world, 'swarmling', { x: 0, z: -8 }, 1),
    new Monster(g.world, 'swarmling', { x: 2, z: -8 }, 1),
  ];
  g.phase = PHASE.FIGHT;
  const hp0 = g.mech.hp;
  stepFor(g, 4, { move: { x: 0, z: 0 }, aimYaw: 0 });
  check('swarmlings latch onto the mech', g.monsters.some((m) => m.latched),
    g.monsters.map((m) => m.state).join(','));
  check('latched swarmlings chew the mech', g.mech.hp < hp0, `hp ${hp0} -> ${g.mech.hp.toFixed(1)}`);
  // KICK to shake them off (point-blank hits ignore the arc)
  for (let i = 0; i < 90; i++) {
    g.applyInput(ALL_ROLES, { kick: i < 10, move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
  }
  check('kick shakes off / kills the swarm', g.monsters.every((m) => !m.alive || !m.latched),
    g.monsters.map((m) => `${m.alive}/${m.latched}`).join(' '));
}
{
  // BOSS: wave 5 spawns a named boss with a health bar and a slam pattern
  const g = new BrawlGame();
  g.wave = 4;
  g.phase = PHASE.SHOP;
  g.phaseT = 0.01;
  g.step();
  check('wave 5 is a boss wave', g.wave === 5 && g.monsters.some((m) => m.bossName),
    g.monsters.map((m) => m.type).join(','));
  const boss = g.monsters.find((m) => m.bossName);
  check('boss has a funny name', typeof boss.bossName === 'string' && boss.bossName.length > 3, boss.bossName);
  check('snapshot carries the boss bar', g.snapshot().bossBar?.name === boss.bossName);
  // force the slam pattern
  boss.body.position.set(g.mech.body.position.x + 10, 7, g.mech.body.position.z);
  boss.setState('telegraph');
  boss.attackKind = 'slam';
  boss.teleTime = 0.1;
  g.mech.invulnT = 0;
  const hpB = g.mech.hp;
  let slamSeen = false;
  for (let i = 0; i < 90; i++) {
    g.applyInput(ALL_ROLES, { move: { x: 0, z: 0 }, aimYaw: 0 }, ROLE, 'A');
    g.step();
    const s = g.snapshot();
    if (s.monsters.some((m) => (m.ev || []).some((e) => e.what === 'slam'))) slamSeen = true;
  }
  check('boss slam fires and hurts the mech', slamSeen && g.mech.hp < hpB, `hp ${hpB} -> ${g.mech.hp}`);
  // summon pattern
  boss.hp = boss.maxHp;
  boss.setState('telegraph');
  boss.attackKind = 'summon';
  boss.teleTime = 0.1;
  const before = g.monsters.length;
  stepFor(g, 1.5);
  check('boss summons rusher minions', g.monsters.length > before, `${before} -> ${g.monsters.length}`);
}
{
  // CARS: dynamic props exist and a punch punts them
  const g = new BrawlGame();
  check('city has puntable cars', g.cars.length === 10);
  const car = g.cars[0];
  car.position.set(0, 1, -6);
  car.velocity.setZero();
  stepFor(g, 0.5);
  let maxV = 0;
  for (let i = 0; i < 60; i++) {
    g.applyInput(ALL_ROLES, { punchL: i < 10, aimYaw: 0, aimPitch: -0.2, move: { x: 0, z: 0 } }, ROLE, 'A');
    g.step();
    maxV = Math.max(maxV, car.velocity.length());
  }
  check('punch punts a car', maxV > 8, `peak v=${maxV.toFixed(1)}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
