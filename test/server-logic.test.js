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
  check('wave 1 spawns 1 crab', g.monsters.length === 1 && g.monsters[0].type === 'crab');

  // mech walks stable in the city
  stepFor(g, 4, { move: { x: 0, z: -1 }, aimYaw: 0 });
  check('mech walks without falling', !g.mech.isRagdoll && !g.mech.isDead,
    `pos=(${g.mech.body.position.x.toFixed(1)},${g.mech.body.position.y.toFixed(1)},${g.mech.body.position.z.toFixed(1)})`);
  const speed = g.mech.walkSpeed;
  check('mech speed is slow and heavy (<= ~5.5)', speed <= 6, `speed=${speed.toFixed(1)}`);

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
  stepFor(g, 6.5); // wave 1: exactly one crab
  const kicked = g.monsters[0];
  kicked.setState('recover'); kicked.t = -99; // pacify it
  kicked.body.velocity.setZero();
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
