import * as CANNON from 'cannon-es';

// Seeded procedural city district: a grid of blocks cut by mech-scale
// avenues, a river strip with bridges, landmark towers, and interactable
// spawns (supply beacons, fuel tanks, repair stations, credit caches).
// The seed is shown on the run summary so crews can share layouts.

const PALETTE = ['#4a5568', '#5a4a6b', '#3d4a5c', '#5c4a4a', '#46586b', '#54466b', '#4f5a4d', '#5e5346'];
export const WORLD_HALF = 170;       // world is ~340 x 340
export const ARENA_RADIUS = 150;     // legacy export (spawn ring clamp)

export function makeSeed() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function seedToInt(seed) {
  let h = 9;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 387420489);
  return Math.abs(h);
}

export function buildCity(world, seed = 'TRAIN') {
  const rng = mulberry32(seedToInt(seed));
  const defs = [];
  const interactables = { beacons: [], tanks: [], stations: [], caches: [] };

  // ground
  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(WORLD_HALF + 60, 1, WORLD_HALF + 60)),
    position: new CANNON.Vec3(0, -1, 0),
  });
  world.addBody(ground);
  defs.push({ kind: 'ground', size: [(WORLD_HALF + 60) * 2, 2, (WORLD_HALF + 60) * 2], p: [0, -1, 0], color: '#23273a' });

  // river: a dark strip crossing the district at a random offset
  const riverX = (rng() - 0.5) * 120;
  defs.push({ kind: 'river', size: [26, (WORLD_HALF + 60) * 2], p: [riverX, 0.05, 0] });

  // block grid with wide avenues
  const BLOCK = 46, AVE = 18;
  const span = BLOCK + AVE;
  const n = Math.floor((WORLD_HALF * 2) / span);
  const start = -((n * span) / 2) + BLOCK / 2;
  let colorI = 0;
  const landmarks = Math.floor(rng() * 2) + 2;
  const blockCenters = [];
  for (let bx = 0; bx < n; bx++) {
    for (let bz = 0; bz < n; bz++) {
      const cx = start + bx * span, cz = start + bz * span;
      if (Math.abs(cx - riverX) < 34) continue;         // river bank: no block
      if (Math.hypot(cx, cz) < 34) { blockCenters.push([cx, cz]); continue; } // spawn plaza stays open
      blockCenters.push([cx, cz]);
      const nB = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < nB; i++) {
        const w = 10 + rng() * 16, d = 10 + rng() * 16;
        const h = 12 + rng() * (30 + (rng() < 0.12 ? 45 : 0));
        const x = cx + (rng() - 0.5) * (BLOCK - w - 4);
        const z = cz + (rng() - 0.5) * (BLOCK - d - 4);
        const body = new CANNON.Body({
          type: CANNON.Body.STATIC,
          shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
          position: new CANNON.Vec3(x, h / 2, z),
        });
        world.addBody(body);
        defs.push({
          kind: 'building', size: [w, h, d], p: [x, h / 2, z], yaw: 0,
          color: PALETTE[colorI++ % PALETTE.length], windows: true,
        });
      }
    }
  }

  // landmark towers (tall, lit) near random block centers
  for (let i = 0; i < landmarks && blockCenters.length; i++) {
    const [cx, cz] = blockCenters[Math.floor(rng() * blockCenters.length)];
    const h = 85 + rng() * 40;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(7, h / 2, 7)),
      position: new CANNON.Vec3(cx, h / 2, cz),
    });
    world.addBody(body);
    defs.push({ kind: 'landmark', size: [14, h, 14], p: [cx, h / 2, cz], color: '#2c3247' });
  }

  // interactable placement: spread across avenue space, min spacing
  const placed = [];
  const place = (min, max) => {
    for (let tries = 0; tries < 60; tries++) {
      const x = (rng() - 0.5) * 2 * (WORLD_HALF - 20);
      const z = (rng() - 0.5) * 2 * (WORLD_HALF - 20);
      if (Math.hypot(x, z) < min || Math.hypot(x, z) > max) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 34)) continue;
      // avoid inside buildings: cheap check versus defs
      const inside = defs.some((d) => d.kind === 'building'
        && Math.abs(x - d.p[0]) < d.size[0] / 2 + 6 && Math.abs(z - d.p[2]) < d.size[2] / 2 + 6);
      if (inside) continue;
      placed.push([x, z]);
      return [x, z];
    }
    return null;
  };

  for (let i = 0; i < 10; i++) { const p = place(14, 160); if (p) interactables.tanks.push({ id: 'ft' + i, p: [p[0], 2, p[1]], hp: 1, alive: true }); }
  for (let i = 0; i < 3; i++) { const p = place(30, 140); if (p) interactables.stations.push({ id: 'rs' + i, p: [p[0], 0, p[1]], hp: 80, maxHp: 80, alive: true }); }
  for (let i = 0; i < 8; i++) { const p = place(20, 160); if (p) interactables.caches.push({ id: 'cc' + i, p: [p[0], 1.5, p[1]], hp: 20, alive: true, credits: 15 + Math.floor(rng() * 16) }); }

  return { defs, interactables, riverX, seed };
}

// Dynamic props: cars the mech (and monsters) can punt.
const CAR_COLORS = ['#6b7a8f', '#8f6b6b', '#6b8f7a', '#7a6b8f', '#8f8a6b'];
export function buildCars(world, count = 14, seedI = 5) {
  const rng = mulberry32(seedI);
  const bodies = [], defs = [];
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 220, z = (rng() - 0.5) * 220;
    const body = new CANNON.Body({
      mass: 2.5,
      shape: new CANNON.Box(new CANNON.Vec3(1.6, 0.7, 0.9)),
      position: new CANNON.Vec3(x, 0.8, z),
      linearDamping: 0.35, angularDamping: 0.5,
    });
    body.quaternion.setFromEuler(0, rng() * Math.PI * 2, 0);
    world.addBody(body);
    bodies.push(body);
    defs.push({ id: 'car' + i, kind: 'car', size: [3.2, 1.4, 1.8], color: CAR_COLORS[i % CAR_COLORS.length] });
  }
  return { bodies, defs };
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
