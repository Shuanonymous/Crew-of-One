import * as CANNON from 'cannon-es';

// Seeded procedural district — DISTRICT-COHERENT, not random box salad.
//
// The map is a street grid cut by mech-scale avenues, zoned by distance
// from the civic center and the waterfront:
//   core      -> glass towers (setback tiers, landmark crowns)
//   commercial-> mid-rise concrete offices
//   residential-> brick walk-ups with rooftop clutter
//   industrial-> low corrugated sheds, tanks, yards (one corner of the map)
//   waterfront-> flood channel, embankments, cranes near the industrial end
//
// The server only owns collision boxes + hp; every def carries archetype,
// tier and seed data so all clients build the same detailed visuals.

const PALETTES = {
  glass: ['#3d4d63', '#37485e', '#42536b', '#3a4a5c'],
  concrete: ['#5a5d66', '#63666e', '#565963', '#6b6a70'],
  brick: ['#6b4a3d', '#75564a', '#5c443c', '#7a5a44'],
  industrial: ['#4d5352', '#575c56', '#4a4f52', '#5d5a50'],
};
export const WORLD_HALF = 170;       // world is ~340 x 340
export const ARENA_RADIUS = 150;     // legacy export (spawn ring clamp)

export function makeSeed() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function seedToInt(seed) {
  seed = String(seed);
  let h = 9;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 387420489);
  return Math.abs(h);
}

export function buildCity(world, seed = 'TRAIN') {
  const rng = mulberry32(seedToInt(seed));
  const defs = [];
  const interactables = { beacons: [], tanks: [], stations: [], caches: [] };
  const buildings = [];

  // ground
  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(WORLD_HALF + 60, 1, WORLD_HALF + 60)),
    position: new CANNON.Vec3(0, -1, 0),
  });
  world.addBody(ground);
  defs.push({ kind: 'ground', size: [(WORLD_HALF + 60) * 2, 2, (WORLD_HALF + 60) * 2], p: [0, -1, 0], color: '#23273a' });

  // waterfront: flood channel crossing the district
  const riverX = (rng() - 0.5) * 120;
  defs.push({ kind: 'river', size: [26, (WORLD_HALF + 60) * 2], p: [riverX, 0.05, 0] });

  // street grid
  const BLOCK = 46, AVE = 18;
  const span = BLOCK + AVE;
  const n = Math.floor((WORLD_HALF * 2) / span);
  const start = -((n * span) / 2) + BLOCK / 2;
  defs.push({ kind: 'roadgrid', span, block: BLOCK, ave: AVE, start, n, riverX });

  // the industrial quarter sits in one seeded corner
  const indCorner = [rng() < 0.5 ? -1 : 1, rng() < 0.5 ? -1 : 1];

  const landmarks = Math.floor(rng() * 2) + 2;
  const blockCenters = [];
  const parkedTypes = ['car', 'car', 'car', 'van', 'bus'];
  const CAR_PAINT = ['#6b7a8f', '#8f6b6b', '#6b8f7a', '#7a6b8f', '#8f8a6b', '#4d5c6e', '#7d5648'];

  for (let bx = 0; bx < n; bx++) {
    for (let bz = 0; bz < n; bz++) {
      const cx = start + bx * span, cz = start + bz * span;
      if (Math.abs(cx - riverX) < 34) continue;                       // river bank: no block
      const centerDist = Math.hypot(cx, cz);
      if (centerDist < 34) { blockCenters.push([cx, cz]); continue; } // spawn plaza stays open
      blockCenters.push([cx, cz]);

      // ---- zoning ----
      const inIndustrial = Math.sign(cx) === indCorner[0] && Math.sign(cz) === indCorner[1] && centerDist > 105;
      let arch, hMin, hMax, maxB;
      if (inIndustrial) { arch = 'industrial'; hMin = 8; hMax = 18; maxB = 2; }
      else if (centerDist < 78) { arch = 'glass'; hMin = 26; hMax = 64; maxB = 2; }
      else if (centerDist < 118) { arch = 'concrete'; hMin = 16; hMax = 38; maxB = 3; }
      else { arch = 'brick'; hMin = 10; hMax = 22; maxB = 3; }

      const nB = 1 + Math.floor(rng() * maxB);
      const palette = PALETTES[arch];
      for (let i = 0; i < nB; i++) {
        const w = (arch === 'industrial' ? 16 : 10) + rng() * 16;
        const d = (arch === 'industrial' ? 14 : 10) + rng() * 16;
        const h = hMin + rng() * (hMax - hMin) * (rng() < 0.14 ? 1.6 : 1);
        const x = cx + (rng() - 0.5) * (BLOCK - w - 4);
        const z = cz + (rng() - 0.5) * (BLOCK - d - 4);
        const body = new CANNON.Body({
          type: CANNON.Body.STATIC,
          shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
          position: new CANNON.Vec3(x, h / 2, z),
        });
        world.addBody(body);
        // tall glass towers get setback tiers (visual only; box collision)
        const tiers = arch === 'glass' && h > 40 && rng() < 0.7
          ? [[1, 0.55 + rng() * 0.15], [0.74 + rng() * 0.1, 0.28], [0.5, 0.17]]
          : null;
        const def = {
          kind: 'building', id: 'b' + buildings.length, size: [w, h, d], p: [x, h / 2, z], yaw: 0,
          color: palette[Math.floor(rng() * palette.length)], arch, tiers,
          v: Math.floor(rng() * 1e6),   // per-building visual seed (rooftops, lit windows)
        };
        defs.push(def);
        buildings.push({ id: def.id, body, def, hp: Math.round(40 + (w * d * h) / 70), maxHp: 0, alive: true });
        if (arch !== 'industrial' && h > 22 && rng() < 0.3) {
          defs.push({
            kind: 'billboard', bldg: def.id,
            p: [x, 6 + rng() * (h - 14), z + d / 2 + 0.35],
            size: [Math.min(9, w * 0.8), 3.4 + rng() * 2.2],
            v: Math.floor(rng() * 3),
          });
        }
      }

      // ---- street furniture + parked vehicles along each block edge ----
      const off = BLOCK / 2 + 3;
      const corners = (bx + bz) % 2 === 0
        ? [[cx - off, cz - off], [cx + off, cz + off]]
        : [[cx - off, cz + off], [cx + off, cz - off]];
      for (const [lx, lz] of corners) {
        if (Math.abs(lx - riverX) < 15) continue;
        defs.push({ kind: 'lamp', p: [lx, 0, lz] });
      }
      // one traffic signal per block corner (alternating), human scale cue
      if ((bx * 3 + bz) % 2 === 0 && Math.abs(cx + off - riverX) > 15) {
        defs.push({ kind: 'traffic', p: [cx + off, 0, cz - off], yaw: rng() * Math.PI * 2 });
      }
      // parked vehicles: 0-3 per block, hugging the curb
      const nPark = Math.floor(rng() * 3.4);
      for (let pv = 0; pv < nPark; pv++) {
        const side = rng() < 0.5 ? -1 : 1;
        const along = (rng() - 0.5) * (BLOCK - 10);
        const horiz = rng() < 0.5;
        const px = horiz ? cx + along : cx + side * (BLOCK / 2 + 2.2);
        const pz = horiz ? cz + side * (BLOCK / 2 + 2.2) : cz + along;
        if (Math.abs(px - riverX) < 16) continue;
        defs.push({
          kind: 'parked', p: [px, 0, pz], yaw: horiz ? 0 : Math.PI / 2,
          type: parkedTypes[Math.floor(rng() * parkedTypes.length)],
          color: CAR_PAINT[Math.floor(rng() * CAR_PAINT.length)],
        });
      }
    }
  }

  // landmark towers (tall, lit) near random block centers
  for (let i = 0; i < landmarks && blockCenters.length; i++) {
    const [cx, cz] = blockCenters[Math.floor(rng() * blockCenters.length)];
    if (Math.hypot(cx, cz) < 40) continue;
    const h = 85 + rng() * 40;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(7, h / 2, 7)),
      position: new CANNON.Vec3(cx, h / 2, cz),
    });
    world.addBody(body);
    defs.push({ kind: 'landmark', size: [14, h, 14], p: [cx, h / 2, cz], color: '#2c3247' });
  }

  // waterfront cranes near the industrial end of the channel
  for (let i = 0; i < 2; i++) {
    const cz = (rng() - 0.5) * 2 * (WORLD_HALF - 40);
    defs.push({ kind: 'crane', p: [riverX + (rng() < 0.5 ? -20 : 20), 0, cz], yaw: rng() * Math.PI * 2 });
  }

  // interactable placement: spread across avenue space, min spacing
  const placed = [];
  const place = (min, max) => {
    for (let tries = 0; tries < 60; tries++) {
      const x = (rng() - 0.5) * 2 * (WORLD_HALF - 20);
      const z = (rng() - 0.5) * 2 * (WORLD_HALF - 20);
      if (Math.hypot(x, z) < min || Math.hypot(x, z) > max) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 34)) continue;
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

  for (const b of buildings) b.maxHp = b.hp;
  return { defs, interactables, riverX, seed, buildings };
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
