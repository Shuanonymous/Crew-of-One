// Shared between server and browser (both use ES modules).

export const PHYSICS_HZ = 60;          // server physics steps per second
export const SNAPSHOT_HZ = 20;         // how often the server broadcasts state
export const INTERP_DELAY_MS = 120;    // clients render this far in the past (smooths jitter)

// ---------------------------------------------------------------------------
// The mech: HEAVY, not slow. Instant reaction, thundering follow-through.
// ---------------------------------------------------------------------------
export const MECH = {
  torsoSize: { x: 4.2, y: 5.6, z: 2.8 },
  torsoMass: 60,
  standHeight: 7.2,
  hoverStrength: 2600,
  hoverDamping: 420,
  balanceStrength: 2600,
  balanceDamping: 520,
  walkForce: 3800,        // a = 63 m/s^2: visibly moving the same frame you press
  maxWalkSpeed: 7.8,      // +50% over v1
  brakeRate: 3.2,         // hard stop when keys release — feet PLANT
  turnTorque: 5200,       // snaps toward the head's view, damped so it settles heavy
  turnDamping: 1300,
  stepLength: 5.0,
  maxHp: 100,

  punch: {
    windup: 0.34,
    swing: 0.16,
    recover: 0.30,
    range: 9.0,
    arc: 1.5,
    damage: 16,
    knockback: 1150,
  },
  kick: {
    windup: 0.46,
    swing: 0.24,
    recover: 0.60,
    range: 10.0,
    arc: 1.3,
    damage: 36,
    knockback: 2600,
    balanceFactor: 0.18,
  },
  laser: {
    chargeTime: 3.0,      // the teamwork tension stays
    fireTime: 2.4,        // long enough to SWEEP across a pack
    dps: 110,             // worth standing still for
    range: 75,
    beamRadius: 2.6,
  },

  fallDotThreshold: 0.35,
  fallGraceSec: 0.4,
  ragdollSec: 3.5,
};

// ---------------------------------------------------------------------------
// The kaiju roster. Six behaviors the crew must solve differently.
// behavior: melee | ranged | flyer | swarm | boss
// ---------------------------------------------------------------------------
export const MONSTERS = {
  crab: {
    name: 'CRABZILLA', behavior: 'melee',
    radius: 3.2, mass: 45, speed: 3.2,
    hp: 42, hpPerWave: 8, damage: 9, damagePerWave: 1.4,
    attackRange: 8.0, telegraph: 1.1, attackDur: 0.35, recover: 0.7,
    knockback: 1300, credits: 20,
  },
  pigeon: {
    name: 'PIGEONZILLA', behavior: 'melee',
    radius: 3.6, mass: 70, speed: 4.3,
    hp: 95, hpPerWave: 11, damage: 16, damagePerWave: 1.8,
    attackRange: 9.0, telegraph: 1.25, attackDur: 0.4, recover: 0.9,
    knockback: 2400, credits: 55,
  },
  rusher: {
    name: 'SCUTTLER', behavior: 'melee',
    radius: 1.6, mass: 12, speed: 7.5,
    hp: 16, hpPerWave: 3, damage: 4, damagePerWave: 0.8,
    attackRange: 4.5, telegraph: 0.55, attackDur: 0.3, recover: 0.5,
    knockback: 420, credits: 8,
  },
  spitter: {
    name: 'LOOGIE LOUIE', behavior: 'ranged',
    radius: 2.6, mass: 30, speed: 2.8,
    hp: 55, hpPerWave: 8, damage: 11, damagePerWave: 1.5,
    attackRange: 34,        // fires from way out here
    preferredRange: 26,     // backs away if you get closer than this
    telegraph: 0.9, attackDur: 0.4, recover: 1.6,
    projSpeed: 26, projRadius: 1.3,
    knockback: 500, credits: 35,
  },
  tank: {
    name: 'SIR CLANKSALOT', behavior: 'melee',
    radius: 5.0, mass: 220, speed: 1.5,
    hp: 320, hpPerWave: 35, damage: 22, damagePerWave: 2.5,
    attackRange: 10.5, telegraph: 1.6, attackDur: 0.5, recover: 1.3,
    knockback: 3200, credits: 90,
    meleeResist: 0.25,      // punches/kicks do 25% — bring the laser
  },
  flyer: {
    name: 'DIVE-BOMB DAVE', behavior: 'flyer',
    radius: 2.4, mass: 25, speed: 9,
    altitude: 15, circleRadius: 26, diveSpeed: 26, divePeriod: 5.5,
    hp: 40, hpPerWave: 6, damage: 12, damagePerWave: 1.6,
    telegraph: 0.9, credits: 45, knockback: 1500,
  },
  swarmling: {
    name: 'GRABLIN', behavior: 'swarm',
    radius: 0.75, mass: 3, speed: 8.5,
    hp: 3, hpPerWave: 0.5, damage: 1.4,   // per second while latched
    telegraph: 0, credits: 2, knockback: 0,
    latchRange: 3.6,
  },
  boss: {
    name: 'BOSS', behavior: 'boss',
    radius: 7.0, mass: 500, speed: 2.3,
    hp: 850, hpPerWave: 30,               // per WAVE number, so boss 2 >> boss 1
    damage: 26, damagePerWave: 1.2,
    attackRange: 13, telegraph: 1.7, attackDur: 0.5, recover: 1.0,
    knockback: 3600, credits: 400,
    meleeResist: 0.6,
    slam: { range: 17, damage: 20, knockback: 3800, telegraph: 1.9 },
  },
};

// Serious kaiju designations. The humor lives in the crew, not the monsters.
export const BOSS_NAMES = [
  'VORAX, THE TIDE THAT WALKS',
  'KHARYBDIS PRIME',
  'THE SILENT COLOSSUS',
  'MERIDIAN WRAITH',
  'CATEGORY-6: NIGHTFALL',
  'THE HOLLOW KING',
];

// ---------------------------------------------------------------------------
// ENDLESS RUN — the danger clock scales everything with time survived.
// ---------------------------------------------------------------------------
export const DANGER = {
  rampSec: 60,             // +1 danger level per minute
  hpScale: 0.22,           // monster hp × (1 + level·this)
  dmgScale: 0.13,
  spawnBase: 4.5,          // spawn credit points per second at level 0
  spawnScale: 0.5,         // + this per level
  bossAtLevels: [3, 6, 9, 12, 16, 20],
  maxMonsters: 26,         // hard cap (performance + readability)
  maxSwarm: 12,            // swarmlings within the cap
  // spawn costs (spawner spends accumulated points)
  costs: { rusher: 6, crab: 12, swarmling: 4, spitter: 18, flyer: 20, pigeon: 26, tank: 45 },
  // danger level at which each type unlocks
  unlocks: { rusher: 0, crab: 0, swarmling: 1, spitter: 1, flyer: 2, pigeon: 3, tank: 4 },
};

// Endless shop: repeatable tiers (price grows 1.35× per buy) + rare specials.
export const SHOP = [
  { id: 'repair', name: 'FIELD REPAIR', desc: '+50 hull', price: 25, repeat: true, priceGrowth: 1.2 },
  { id: 'dmg', name: 'FIST SERVOS', desc: '+20% melee damage', price: 45, repeat: true, priceGrowth: 1.35 },
  { id: 'armor', name: 'COMPOSITE PLATING', desc: '+10% damage reduction (stacks to 60%)', price: 45, repeat: true, priceGrowth: 1.35 },
  { id: 'speed', name: 'ACTUATOR OVERDRIVE', desc: '+12% move speed', price: 40, repeat: true, priceGrowth: 1.35 },
  { id: 'laser', name: 'CAPACITOR BANKS', desc: '+25% laser damage, -10% charge time', price: 50, repeat: true, priceGrowth: 1.35 },
  { id: 'rocket', name: 'ROCKET FIST', desc: 'RARE: whiffed punches launch the fist', price: 120 },
  { id: 'turret', name: 'SHOULDER TURRET', desc: 'RARE: auto-cannon tracks nearby hostiles', price: 140 },
  { id: 'dash', name: 'DASH THRUSTERS', desc: 'RARE: LEGS double-tap = thruster dash', price: 130 },
];
export const BEACON_RADIUS = 9;   // stand this close to a supply beacon to shop

// ---------------------------------------------------------------------------
// Rooms, roles, modes, protocol
// ---------------------------------------------------------------------------
export const MODES = { BRAWL: 'brawl', DUEL: 'duel', TRAINING: 'training' };

export const ROLE = { LEGS: 'LEGS', ARM_L: 'ARM_L', ARM_R: 'ARM_R', HEAD: 'HEAD' };

export function splitRoles(count) {
  const R = ROLE;
  switch (count) {
    case 1: return [[R.LEGS, R.ARM_L, R.ARM_R, R.HEAD]];
    case 2: return [[R.LEGS], [R.ARM_L, R.ARM_R, R.HEAD]];
    case 3: return [[R.LEGS], [R.ARM_L, R.ARM_R], [R.HEAD]];
    default: return [[R.LEGS], [R.ARM_L], [R.ARM_R], [R.HEAD]];
  }
}

export function roleTitle(roles) {
  const has = (r) => roles.includes(r);
  if (has(ROLE.LEGS) && has(ROLE.HEAD)) return 'THE WHOLE MECH';
  if (has(ROLE.ARM_L) && has(ROLE.ARM_R) && has(ROLE.HEAD)) return 'ARMS & HEAD';
  if (has(ROLE.ARM_L) && has(ROLE.ARM_R)) return 'THE ARMS';
  if (has(ROLE.ARM_L)) return 'THE LEFT ARM';
  if (has(ROLE.ARM_R)) return 'THE RIGHT ARM';
  if (has(ROLE.HEAD)) return 'THE HEAD';
  if (has(ROLE.LEGS)) return 'THE LEGS';
  return 'CARGO';
}

export const MSG = {
  CREATE: 'create', JOIN: 'join', LEAVE: 'leave',
  SET_MODE: 'setMode', START: 'start', INPUT: 'input',
  BUY: 'buy', SHOP_DONE: 'shopDone', AGAIN: 'again', TO_LOBBY: 'toLobby',
  WELCOME: 'welcome', ROOM: 'room', GAME_START: 'gameStart',
  STATE: 'state', GAME_END: 'gameEnd', ERR: 'err',
};

export const PHASE = { FIGHT: 'fight', SHOP: 'shop', DEAD: 'dead', WIN: 'win' };
