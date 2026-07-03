import * as CANNON from 'cannon-es';

// Builds the low-poly city arena: a big open plaza ringed by chunky
// pastel buildings. Returns { defs } — the draw list sent to clients —
// and adds the matching static bodies to the physics world.

const PALETTE = ['#f2a65a', '#ef767a', '#7d9df0', '#6fc2a0', '#c78bd6', '#f5d76e', '#8ad6e6', '#e8926f'];

export const ARENA_RADIUS = 48;   // open fighting space
const CITY_OUTER = 95;            // buildings live between ARENA_RADIUS+6 and here

export function buildCity(world, seed = 7) {
  const rng = mulberry32(seed);
  const defs = [];

  // Ground: asphalt slab
  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(160, 1, 160)),
    position: new CANNON.Vec3(0, -1, 0),
  });
  world.addBody(ground);
  defs.push({ kind: 'ground', size: [320, 2, 320], p: [0, -1, 0], color: '#3d4155' });

  // Plaza disc (visual only)
  defs.push({ kind: 'disc', size: [ARENA_RADIUS + 4], p: [0, 0.02, 0], color: '#4a4f68' });
  defs.push({ kind: 'disc', size: [ARENA_RADIUS - 2], p: [0, 0.04, 0], color: '#555b78' });

  // Buildings: rings of blocks with street gaps monsters wander in through
  let bIndex = 0;
  for (let ring = 0; ring < 3; ring++) {
    const r = ARENA_RADIUS + 10 + ring * 15;
    const count = 14 + ring * 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.2;
      // leave 4 street gaps at the diagonals of the inner ring
      if (ring === 0 && Math.abs(((a * 4 / Math.PI + 1) % 2) - 1) < 0.22) continue;
      if (rng() < 0.18) continue; // demolition happened here
      const w = 7 + rng() * 8;
      const d = 7 + rng() * 8;
      const h = 10 + rng() * (16 + ring * 10);
      const x = Math.cos(a) * (r + rng() * 6);
      const z = Math.sin(a) * (r + rng() * 6);
      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
        position: new CANNON.Vec3(x, h / 2, z),
      });
      body.quaternion.setFromEuler(0, rng() * 0.5 - 0.25, 0);
      world.addBody(body);
      defs.push({
        kind: 'building',
        size: [w, h, d],
        p: [x, h / 2, z],
        yaw: body.quaternion.y !== 0 ? 2 * Math.asin(body.quaternion.y) : 0,
        color: PALETTE[bIndex++ % PALETTE.length],
        windows: rng() > 0.25,
      });
    }
  }

  // A few landmark blocks INSIDE the arena edge for cover/comedy
  const landmarks = [
    { x: 26, z: -20, w: 9, d: 9, h: 13 },
    { x: -28, z: 16, w: 8, d: 8, h: 11 },
    { x: 6, z: 32, w: 10, d: 8, h: 9 },
  ];
  for (const L of landmarks) {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(L.w / 2, L.h / 2, L.d / 2)),
      position: new CANNON.Vec3(L.x, L.h / 2, L.z),
    });
    world.addBody(body);
    defs.push({
      kind: 'building', size: [L.w, L.h, L.d], p: [L.x, L.h / 2, L.z],
      yaw: 0, color: PALETTE[bIndex++ % PALETTE.length], windows: true,
    });
  }

  return { defs, arenaRadius: ARENA_RADIUS };
}

// Dynamic props: cars that punches, kicks, monsters, and physics can punt.
const CAR_COLORS = ['#ef767a', '#7d9df0', '#f5d76e', '#6fc2a0', '#fdf6ec', '#f2a65a'];
export function buildCars(world, count = 10, seed = 5) {
  const rng = mulberry32(seed);
  const bodies = [];
  const defs = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = ARENA_RADIUS * (0.35 + rng() * 0.55);
    const body = new CANNON.Body({
      mass: 2.5,
      shape: new CANNON.Box(new CANNON.Vec3(1.6, 0.7, 0.9)),
      position: new CANNON.Vec3(Math.cos(a) * r, 0.8, Math.sin(a) * r),
      linearDamping: 0.35,
      angularDamping: 0.5,
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
