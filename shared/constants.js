// Shared between server and browser (both use ES modules).

export const PHYSICS_HZ = 60;          // server physics steps per second
export const SNAPSHOT_HZ = 20;         // how often the server broadcasts state
export const INTERP_DELAY_MS = 120;    // clients render this far in the past (smooths jitter)

// ---------------------------------------------------------------------------
// The mech: HUGE, SLOW, HEAVY. Weight over agility, comedy over precision.
// ---------------------------------------------------------------------------
export const MECH = {
  torsoSize: { x: 4.2, y: 5.6, z: 2.8 },
  torsoMass: 60,
  standHeight: 7.2,       // torso center hover height (long legs below)
  hoverStrength: 2600,
  hoverDamping: 420,
  balanceStrength: 2600,  // heavy mechs don't flop... unless kicked hard
  balanceDamping: 520,
  walkForce: 2100,
  maxWalkSpeed: 5.2,
  turnTorque: 2400,       // body slowly swings to face where the HEAD looks
  turnDamping: 900,
  stepLength: 4.4,        // meters of travel per footstep (for THUD events)
  maxHp: 100,

  // ARMS — punches. Wind up, then swing.
  punch: {
    windup: 0.55,
    swing: 0.22,
    recover: 0.5,
    range: 8.5,           // from mech center
    arc: 1.5,             // radians, total width of the hit wedge
    damage: 14,
    knockback: 900,
  },
  // LEGS — the kick. Powerful but risky: you're on one leg.
  kick: {
    windup: 0.7,
    swing: 0.3,
    recover: 0.9,
    range: 9.5,
    arc: 1.2,
    damage: 30,
    knockback: 2100,
    balanceFactor: 0.18,  // balance strength multiplier while kicking (wobble!)
  },
  // HEAD — the eye laser. 3 s charge, mech holds still.
  laser: {
    chargeTime: 3.0,
    fireTime: 1.4,
    dps: 42,
    range: 60,
    beamRadius: 2.2,
  },

  fallDotThreshold: 0.35,
  fallGraceSec: 0.4,
  ragdollSec: 3.5,
};

// ---------------------------------------------------------------------------
// Goofy kaiju
// ---------------------------------------------------------------------------
export const MONSTERS = {
  crab: {
    name: 'CRABZILLA',
    radius: 3.2,
    mass: 45,
    speed: 2.3,
    hp: 42,
    hpPerWave: 9,
    damage: 9,
    damagePerWave: 1.5,
    attackRange: 8.0,
    telegraph: 1.3,       // claw raised, plenty of warning
    attackDur: 0.45,
    recover: 1.1,
    knockback: 1300,      // what its swipe does to the mech
    credits: 20,
  },
  pigeon: {
    name: 'PIGEONZILLA',
    radius: 3.6,
    mass: 70,
    speed: 3.1,
    hp: 95,
    hpPerWave: 12,
    damage: 16,
    damagePerWave: 2,
    attackRange: 9.0,
    telegraph: 1.5,
    attackDur: 0.5,
    recover: 1.4,
    knockback: 2400,
    credits: 55,
  },
};

// Wave recipes; past the table it keeps scaling.
export const WAVES = [
  { crab: 1, pigeon: 0 },
  { crab: 2, pigeon: 0 },
  { crab: 2, pigeon: 1 },
  { crab: 3, pigeon: 1 },
  { crab: 2, pigeon: 2 },
  { crab: 4, pigeon: 2 },
];
export function waveRecipe(n) {
  if (n <= WAVES.length) return WAVES[n - 1];
  return { crab: 2 + Math.ceil(n / 2), pigeon: n - 4 };
}

// ---------------------------------------------------------------------------
// The between-waves shop. Prices in hard-earned kaiju credits.
// ---------------------------------------------------------------------------
export const SHOP = [
  { id: 'repair', name: 'DUCT TAPE & WELDING', desc: '+45 mech HP', price: 30, repeat: true },
  { id: 'fists', name: 'COMICALLY LARGE FISTS', desc: 'Punches hit way harder and wider', price: 60 },
  { id: 'laser', name: 'ESPRESSO LASER', desc: 'Eye laser charges twice as fast', price: 60 },
  { id: 'rocket', name: 'ROCKET PUNCH', desc: 'Punches launch the fist as a missile', price: 90 },
  { id: 'armor', name: 'LEG ARMOR (TRASH CAN LIDS)', desc: 'Take 30% less damage', price: 50 },
  { id: 'coffee', name: 'LEG DAY PROTOCOL', desc: 'Walk 30% faster', price: 45 },
];
export const SHOP_TIME = 25; // seconds between waves

// ---------------------------------------------------------------------------
// Rooms, roles, modes, protocol
// ---------------------------------------------------------------------------
export const MODES = {
  BRAWL: 'brawl',
  DUEL: 'duel',
  TRAINING: 'training',
};

export const ROLE = {
  LEGS: 'LEGS',
  ARM_L: 'ARM_L',
  ARM_R: 'ARM_R',
  HEAD: 'HEAD',
};

// What each crew size gets. Roles listed per player slot.
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
  // client -> server
  CREATE: 'create',
  JOIN: 'join',
  LEAVE: 'leave',
  SET_MODE: 'setMode',
  START: 'start',
  INPUT: 'input',
  BUY: 'buy',
  SHOP_DONE: 'shopDone',
  AGAIN: 'again',
  TO_LOBBY: 'toLobby',
  // server -> client
  WELCOME: 'welcome',
  ROOM: 'room',       // lobby / player-list / role updates
  GAME_START: 'gameStart',
  STATE: 'state',
  GAME_END: 'gameEnd',
  ERR: 'err',
};

// Brawl phases inside a run
export const PHASE = {
  FIGHT: 'fight',
  SHOP: 'shop',
  DEAD: 'dead',
  WIN: 'win',       // duel: round over
};
