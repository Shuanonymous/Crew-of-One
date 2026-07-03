// Shared between server and browser (both use ES modules).

export const PHYSICS_HZ = 60;          // server physics steps per second
export const SNAPSHOT_HZ = 20;         // how often the server broadcasts state
export const INTERP_DELAY_MS = 120;    // clients render this far in the past (smooths jitter)

// Robot tuning — "wobbly and controllable"
export const ROBOT = {
  torsoSize: { x: 1.6, y: 2.2, z: 1.0 }, // half-extents are half of these
  torsoMass: 12,
  standHeight: 2.6,      // how high the torso center hovers above the ground
  hoverStrength: 260,    // spring holding the robot up (soft = bouncy)
  hoverDamping: 26,
  balanceStrength: 115,  // torque keeping it upright (soft = wobbly)
  balanceDamping: 15,
  walkForce: 190,
  maxWalkSpeed: 7.5,
  jumpImpulse: 95,
  leanTorque: 60,        // head player leaning with A/D
  maxLeanRad: 0.45,
  armReach: 3.4,         // how far a hand can be from the torso
  grabRadius: 2.2,       // how close a hand must be to an object to grab it (generous = funny)
  shoveImpulse: 40,      // punch strength when clicking with nothing to grab
  fallDotThreshold: 0.35, // if torso "up" tilts past ~70 degrees -> fall
  fallGraceSec: 0.45,     // must be tilted this long before it counts as a fall
  ragdollSec: 3.0,        // comedy flop time before respawn
};

// Message types (client <-> server)
export const MSG = {
  // client -> server
  INPUT: 'input',
  HELLO: 'hello',
  // server -> client
  WELCOME: 'welcome',
  STATE: 'state',
  EVENT: 'event', // one-off things: fell, respawned, grabbed...
};

// Player roles
export const ROLE = {
  LEGS: 'LEGS',
  ARMS: 'ARMS',
  HEAD: 'HEAD',
  ALL: 'ALL', // Phase 1 solo testing: one player is the whole crew
};
