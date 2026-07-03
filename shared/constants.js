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

export const BOSS_NAMES = [
  'BARONESS PINCHELOT THE UNREASONABLE',
  'GARY, DEVOURER OF BUS STOPS',
  'THE HONORABLE JUDGE CLAWSTICE',
  'KEVIN THE ABSOLUTE UNIT',
  'DUKE SLAMWICH THE THIRD',
  'PRINCESS STOMPATHY',
];

// Wave recipes: composition forces a different plan each round.
export const WAVES = [
  { crab: 2 },                                   // 1 — hello
  { rusher: 4 },                                 // 2 — punish slow crews
  { crab: 2, spitter: 1 },                       // 3 — someone must close distance
  { rusher: 3, flyer: 1 },                       // 4 — eyes up
  { boss: 1, rusher: 2 },                        // 5 — BOSS
  { swarmling: 10, crab: 1 },                    // 6 — SHAKE THEM OFF
  { spitter: 2, tank: 1 },                       // 7 — laser the tin can
  { flyer: 2, rusher: 4, pigeon: 1 },            // 8
  { tank: 1, swarmling: 10, spitter: 1 },        // 9 — chaos
  { boss: 1, flyer: 1, rusher: 3 },              // 10 — BOSS
];
export function waveRecipe(n) {
  if (n <= WAVES.length) return WAVES[n - 1];
  if (n % 5 === 0) return { boss: 1, rusher: 2 + Math.floor(n / 5), flyer: 1 };
  const k = n - WAVES.length;
  return {
    crab: 1 + (n % 3), rusher: 2 + (n % 4), spitter: 1 + (k % 2),
    tank: n % 3 === 0 ? 1 : 0, flyer: 1 + (n % 2), swarmling: n % 2 === 0 ? 8 : 0,
    pigeon: n % 3 === 1 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// The between-waves shop.
// ---------------------------------------------------------------------------
export const SHOP = [
  { id: 'repair', name: 'DUCT TAPE & WELDING', desc: '+45 mech HP', price: 30, repeat: true },
  { id: 'fists', name: 'COMICALLY LARGE FISTS', desc: 'Punches hit way harder and wider', price: 60 },
  { id: 'laser', name: 'ESPRESSO LASER', desc: 'Eye laser charges twice as fast', price: 60 },
  { id: 'rocket', name: 'ROCKET PUNCH', desc: 'Punches launch the fist as a missile', price: 90 },
  { id: 'armor', name: 'LEG ARMOR (TRASH CAN LIDS)', desc: 'Take 30% less damage', price: 50 },
  { id: 'coffee', name: 'LEG DAY PROTOCOL', desc: 'Walk 30% faster', price: 45 },
];
export const SHOP_TIME = 25;

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
