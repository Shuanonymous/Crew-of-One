// Shared mech-customization catalog. Used by BOTH the server (authoritative
// validation + stat derivation) and the client (hangar UI + mech factory).
// Everything here is original IP for this project.
//
// A "build" is plain JSON:
// {
//   frame, head, torso, armL, armR, legs, shoulderL, shoulderR, armorKit,
//   paint: { primary, secondary, accent, emissive, finish, weathering },
//   decal, callsign
// }

// ---------------------------------------------------------------------------
// LAYERS + role ownership.
// Owner role proposes/sets directly; everyone else files a proposal.
// SHARED layers are decided by proposal + votes + host confirmation.
// ---------------------------------------------------------------------------
export const LAYERS = [
  'frame', 'head', 'torso', 'armL', 'armR', 'legs',
  'shoulderL', 'shoulderR', 'armorKit', 'paint', 'decal', 'callsign',
];

export const LAYER_OWNER = {
  frame: 'SHARED',        // chassis: whole-crew decision
  head: 'HEAD',           // gunner/sensors
  torso: 'LEGS',          // pilot owns reactor/stability systems
  armL: 'ARM_L',
  armR: 'ARM_R',
  legs: 'LEGS',
  shoulderL: 'ARM_L',     // ordnance rides with the arm crew
  shoulderR: 'ARM_R',
  armorKit: 'SHARED',
  paint: 'SHARED',
  decal: 'SHARED',
  callsign: 'SHARED',
};

// ---------------------------------------------------------------------------
// The catalog. cost = duel-budget points. Stats are multipliers/deltas the
// server applies; the client only READS them for the compare panel.
// ---------------------------------------------------------------------------
export const LOADOUT = {
  frame: [
    { id: 'vanguard', name: 'VG-3 VANGUARD', desc: 'Light recon frame. Fast, agile, thin plate.', cost: 2,
      stats: { hpMul: 0.82, speedMul: 1.18, turnMul: 1.15, massMul: 0.85 } },
    { id: 'warden', name: 'WD-7 WARDEN', desc: 'Balanced line frame. The fleet workhorse.', cost: 3,
      stats: { hpMul: 1.0, speedMul: 1.0, turnMul: 1.0, massMul: 1.0 } },
    { id: 'bastion', name: 'BS-9 BASTION', desc: 'Heavy siege frame. Slow, brutally armoured.', cost: 4,
      stats: { hpMul: 1.28, speedMul: 0.86, turnMul: 0.88, massMul: 1.25, armorDR: 0.08 } },
  ],
  head: [
    { id: 'oracle', name: 'ORACLE ARRAY', desc: 'Wide-band sensor cluster. Faster beam charge.', cost: 2,
      stats: { laserChargeMul: 0.85 } },
    { id: 'cyclops', name: 'CYCLOPS OPTIC', desc: 'Single heavy emitter. Hotter beam, slower charge.', cost: 3,
      stats: { laserDmgMul: 1.2, laserChargeMul: 1.1 } },
    { id: 'talon', name: 'TALON VISOR', desc: 'Fire-control visor. Longer missile lock range.', cost: 2,
      stats: { lockRangeMul: 1.35 } },
  ],
  torso: [
    { id: 'aegis', name: 'AEGIS CORE', desc: 'Standard reactor housing. No compromises.', cost: 2, stats: {} },
    { id: 'furnace', name: 'FURNACE PLANT', desc: 'Overdriven reactor. Longer beam burn, thinner plate.', cost: 3,
      stats: { laserFireTimeMul: 1.3, armorDR: -0.04 } },
    { id: 'rampart', name: 'RAMPART HOUSING', desc: 'Armoured reactor vault. +plate, slower shoulders.', cost: 3,
      stats: { armorDR: 0.06, speedMul: 0.96 } },
  ],
  arm: [ // used for both armL and armR
    { id: 'breaker', name: 'BREAKER FIST', desc: 'Standard demolition fist.', cost: 2,
      stats: { meleeMul: 1.0 } },
    { id: 'piledriver', name: 'PILEDRIVER RAM', desc: 'Reinforced impact ram. Heavier hits, slower swing.', cost: 3,
      stats: { meleeMul: 1.35, swingMul: 1.15 } },
    { id: 'falchion', name: 'FALCHION BLADE', desc: 'Thermal cutting blade. Fast lethal arcs.', cost: 3,
      stats: { meleeMul: 1.18, swingMul: 0.85 } },
    { id: 'howler', name: 'HOWLER CANNON', desc: 'Integral rotary cannon. Hold to spin up. Weak melee.', cost: 4,
      grants: ['cannon'], stats: { meleeMul: 0.55 } },
    { id: 'bulwark', name: 'BULWARK SHIELD', desc: 'Tower shield emitter. Frontal damage soak, weak melee.', cost: 3,
      requiresFrame: ['warden', 'bastion'], stats: { meleeMul: 0.5, armorDR: 0.08 } },
  ],
  legs: [
    { id: 'strider', name: 'STRIDER MK.II', desc: 'Standard biped locomotion.', cost: 2, stats: {} },
    { id: 'colossus', name: 'COLOSSUS LEGS', desc: 'Heavy reinforced legs. Devastating kick, slower gait.', cost: 3,
      stats: { kickMul: 1.4, speedMul: 0.92, stabilityMul: 1.25 } },
    { id: 'vector', name: 'VECTOR THRUST', desc: 'Thruster-assisted legs. Built-in dash.', cost: 4,
      requiresFrame: ['vanguard', 'warden'], grants: ['dash'], stats: { speedMul: 1.08 } },
    { id: 'anchor', name: 'ANCHOR FRAME', desc: 'Stability-first legs. Very hard to knock down.', cost: 2,
      stats: { stabilityMul: 1.6, speedMul: 0.95 } },
  ],
  shoulder: [ // used for both shoulderL and shoulderR
    { id: 'empty', name: 'NO MOUNT', desc: 'Bare hardpoint.', cost: 0, stats: {} },
    { id: 'hydra', name: 'HYDRA POD', desc: 'Homing rocket pod. HEAD fires with R.', cost: 4, grants: ['pods'], stats: {} },
    { id: 'sentry', name: 'SENTRY GUN', desc: 'Automatic close-defence turret.', cost: 3, grants: ['turret'], stats: {} },
    { id: 'projector', name: 'AEGIS PROJECTOR', desc: 'Field projector. Small constant damage soak.', cost: 3,
      stats: { armorDR: 0.05 } },
    { id: 'forge', name: 'FORGE RIG', desc: 'Auto-repair gantry. Slowly rebuilds hull plate.', cost: 3,
      stats: { regenHps: 0.6 } },
  ],
  armorKit: [
    { id: 'none', name: 'NO KIT', desc: 'Bare chassis plate only.', cost: 0, stats: {} },
    { id: 'skirmish', name: 'SKIRMISH KIT', desc: 'Light applique plates on chest and shins.', cost: 2,
      stats: { armorDR: 0.05, speedMul: 0.98 } },
    { id: 'siege', name: 'SIEGE KIT', desc: 'Full up-armour: chest, shoulders, forearms, thighs.', cost: 4,
      requiresFrame: ['warden', 'bastion'], stats: { armorDR: 0.12, speedMul: 0.93 } },
  ],
};

// ---------------------------------------------------------------------------
// Paint. Curated cinematic presets; custom colours are validated (luminance
// clamps keep the mech readable against the night city).
// ---------------------------------------------------------------------------
export const PAINT_PRESETS = [
  { id: 'harbor', name: 'HARBOR WATCH', primary: '#5f6c7d', secondary: '#39434f', accent: '#d8a03c', emissive: '#3fd6ff', finish: 0.35, weathering: 0.5 },
  { id: 'nightline', name: 'NIGHTLINE', primary: '#3a4149', secondary: '#23272e', accent: '#c34a4a', emissive: '#ff5b4d', finish: 0.3, weathering: 0.35 },
  { id: 'aurora', name: 'AURORA', primary: '#67788f', secondary: '#3d4a61', accent: '#59d6b5', emissive: '#63ffd8', finish: 0.22, weathering: 0.2 },
  { id: 'vermilion', name: 'VERMILION GUARD', primary: '#8a4238', secondary: '#4a2a26', accent: '#d8c06a', emissive: '#ffb13f', finish: 0.4, weathering: 0.55 },
  { id: 'pale', name: 'PALE SENTINEL', primary: '#9aa3ac', secondary: '#5d6670', accent: '#3f6fd8', emissive: '#7fb2ff', finish: 0.28, weathering: 0.3 },
  { id: 'onyx', name: 'ONYX PROTOCOL', primary: '#2e3138', secondary: '#1c1e24', accent: '#8f6fff', emissive: '#b18cff', finish: 0.18, weathering: 0.25 },
];

export const DECALS = [
  { id: 'none', name: 'NONE' },
  { id: 'stripes', name: 'ID STRIPES' },
  { id: 'digits', name: 'HULL NUMBER' },
  { id: 'wedge', name: 'WARN WEDGE' },
  { id: 'crest', name: 'CREW CREST' },
];

export const CALLSIGN_PRESETS = [
  'IRONWAKE', 'LONG NIGHT', 'HARBORLIGHT', 'STONE HALO', 'LAST ANVIL',
  'GREY WARDEN', 'TIDEBREAK', 'EMBER ROW', 'NORTH WALL', 'VIGIL',
];

export const DUEL_BUDGET = 24;   // duels are mirror matches; budget bounds silly stacks

export const DEFAULT_BUILD = Object.freeze({
  frame: 'warden', head: 'oracle', torso: 'aegis',
  armL: 'breaker', armR: 'breaker', legs: 'strider',
  shoulderL: 'empty', shoulderR: 'empty', armorKit: 'none',
  paint: { ...PAINT_PRESETS[0], id: undefined, name: undefined },
  decal: 'stripes',
  callsign: 'IRONWAKE',
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function partsFor(layer) {
  if (layer === 'armL' || layer === 'armR') return LOADOUT.arm;
  if (layer === 'shoulderL' || layer === 'shoulderR') return LOADOUT.shoulder;
  return LOADOUT[layer] || [];
}

export function findPart(layer, id) {
  return partsFor(layer).find((p) => p.id === id) || null;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function hexOk(c) { return typeof c === 'string' && HEX_RE.test(c); }
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export function sanitizePaint(paint) {
  const base = DEFAULT_BUILD.paint;
  const p = typeof paint === 'object' && paint ? paint : {};
  const out = {
    primary: hexOk(p.primary) ? p.primary : base.primary,
    secondary: hexOk(p.secondary) ? p.secondary : base.secondary,
    accent: hexOk(p.accent) ? p.accent : base.accent,
    emissive: hexOk(p.emissive) ? p.emissive : base.emissive,
    finish: clamp01(p.finish, base.finish),
    weathering: clamp01(p.weathering, base.weathering),
  };
  // readability clamps: hull colours must stay off pure-black / pure-white
  if (lum(out.primary) < 0.06 || lum(out.primary) > 0.85) out.primary = base.primary;
  if (lum(out.secondary) > 0.8) out.secondary = base.secondary;
  return out;
}
function clamp01(v, dflt) { return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : dflt; }

// Normalize + validate a whole build. Always returns a usable build; `ok`
// is false when anything had to be corrected (with the first reason).
export function validateBuild(raw) {
  const b = typeof raw === 'object' && raw ? raw : {};
  const out = {};
  let ok = true, reason = null;
  const bad = (r) => { if (ok) { ok = false; reason = r; } };

  const frame = findPart('frame', b.frame) ? b.frame : (bad('unknown frame'), DEFAULT_BUILD.frame);
  out.frame = frame;

  for (const layer of ['head', 'torso', 'armL', 'armR', 'legs', 'shoulderL', 'shoulderR', 'armorKit']) {
    let part = findPart(layer, b[layer]);
    if (!part) { bad('unknown ' + layer); part = findPart(layer, DEFAULT_BUILD[layer]); }
    if (part.requiresFrame && !part.requiresFrame.includes(frame)) {
      bad(`${part.name} not compatible with ${frame} frame`);
      part = findPart(layer, DEFAULT_BUILD[layer]);
    }
    out[layer] = part.id;
  }

  out.paint = sanitizePaint(b.paint);
  out.decal = DECALS.some((d) => d.id === b.decal) ? b.decal : DEFAULT_BUILD.decal;
  out.callsign = String(b.callsign || DEFAULT_BUILD.callsign).replace(/[^\w \-']/g, '').slice(0, 18).trim() || DEFAULT_BUILD.callsign;
  return { ok, reason, build: out };
}

export function buildCost(build) {
  let cost = 0;
  for (const layer of ['frame', 'head', 'torso', 'armL', 'armR', 'legs', 'shoulderL', 'shoulderR', 'armorKit']) {
    const part = findPart(layer, build[layer]);
    cost += part ? part.cost : 0;
  }
  return cost;
}

// Server-authoritative stat derivation. The client never computes gameplay
// stats from its own copy — it only displays these numbers.
export function deriveStats(build) {
  const d = {
    hpMul: 1, speedMul: 1, turnMul: 1, massMul: 1,
    meleeMulL: 1, meleeMulR: 1, kickMul: 1,
    laserChargeMul: 1, laserDmgMul: 1, laserFireTimeMul: 1, lockRangeMul: 1,
    armorDR: 0, stabilityMul: 1, regenHps: 0,
    grants: { cannon: false, pods: false, turret: false, dash: false },
  };
  const mul = (k, v) => { d[k] *= v; };
  const apply = (layer, side) => {
    const part = findPart(layer, build[layer]);
    if (!part) return;
    const s = part.stats || {};
    if (s.hpMul) mul('hpMul', s.hpMul);
    if (s.speedMul) mul('speedMul', s.speedMul);
    if (s.turnMul) mul('turnMul', s.turnMul);
    if (s.massMul) mul('massMul', s.massMul);
    if (s.kickMul) mul('kickMul', s.kickMul);
    if (s.laserChargeMul) mul('laserChargeMul', s.laserChargeMul);
    if (s.laserDmgMul) mul('laserDmgMul', s.laserDmgMul);
    if (s.laserFireTimeMul) mul('laserFireTimeMul', s.laserFireTimeMul);
    if (s.lockRangeMul) mul('lockRangeMul', s.lockRangeMul);
    if (s.stabilityMul) mul('stabilityMul', s.stabilityMul);
    if (s.armorDR) d.armorDR += s.armorDR;
    if (s.regenHps) d.regenHps += s.regenHps;
    if (s.meleeMul) {
      if (side === 'L') mul('meleeMulL', s.meleeMul);
      else if (side === 'R') mul('meleeMulR', s.meleeMul);
      else { mul('meleeMulL', s.meleeMul); mul('meleeMulR', s.meleeMul); }
    }
    for (const g of part.grants || []) d.grants[g] = true;
  };
  apply('frame'); apply('head'); apply('torso');
  apply('armL', 'L'); apply('armR', 'R');
  apply('legs'); apply('shoulderL'); apply('shoulderR'); apply('armorKit');
  d.armorDR = Math.max(0, Math.min(0.35, d.armorDR)); // pre-shop cap
  return d;
}

// Compact stat readout for the hangar compare panel.
export function statReadout(build) {
  const d = deriveStats(build);
  return [
    ['HULL', Math.round(100 * d.hpMul)],
    ['SPEED', Math.round(100 * d.speedMul)],
    ['PLATE', Math.round(100 * d.armorDR) + '%'],
    ['MELEE', Math.round(50 * (d.meleeMulL + d.meleeMulR))],
    ['BEAM', Math.round(100 * d.laserDmgMul * d.laserFireTimeMul)],
    ['STAB', Math.round(100 * d.stabilityMul)],
  ];
}

export const LOADOUT_MSG = 'loadout';   // websocket message type (C<->S)
