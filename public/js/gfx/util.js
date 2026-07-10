import * as THREE from 'three';

// Shared math + geometry helpers for the render layer.

export const V3 = THREE.Vector3;
export const CAMERA_Q = new THREE.Quaternion();

export function lerp(a, b, t) { return a + (b - a) * t; }
export function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
export function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
export function bounce(t) {
  if (t < 0.6) return (t / 0.6) * 1.15;
  return 1.15 - 0.15 * ((t - 0.6) / 0.4);
}
export function damp(cur, target, speed, dt) { return cur + (target - cur) * Math.min(1, speed * dt); }
export function clampN(n, m) { return Math.max(-m, Math.min(m, n)); }

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function getYaw(q) {
  const fwd = new V3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-fwd.x, -fwd.z);
}

export function hashStr(s) {
  let h = 9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
  return Math.abs(h ^ (h >>> 9));
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c;
}

// Stretch a unit-height mesh between two world points (arm segments, beams).
export function placeSegment(mesh, a, b, radiusScale = 1) {
  const dir = b.clone().sub(a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(radiusScale, len, radiusScale);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
}
export function placeBeam(mesh, a, b) { placeSegment(mesh, a, b, 1); }

// Rescale a BoxGeometry's UVs so a texture tiles in WORLD units (one tile
// = tileW x tileH meters) instead of stretching once per face. Box face
// order: +x, -x, +y, -y, +z, -z (4 verts each).
export function worldUVBox(geo, w, h, d, tileW = 12, tileH = 24) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    let su = 1, sv = 1;
    if (face === 0 || face === 1) { su = d / tileW; sv = h / tileH; }        // ±x sides
    else if (face === 2 || face === 3) { su = w / tileW; sv = d / tileW; }   // roof/floor
    else { su = w / tileW; sv = h / tileH; }                                 // ±z faces
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geo;
}

// Displace a geometry's vertices along their normals by seeded fBm noise —
// turns a perfect icosahedron into an organic, asymmetric mass. Welded
// per-position hashing keeps shared vertices together (no cracks).
export function organicDisplace(geo, amount = 0.25, freq = 1.4, seed = 7) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const v = new V3(), n = new V3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const d = fbm3(v.x * freq + seed * 13.7, v.y * freq + seed * 5.1, v.z * freq + seed * 9.3, 3);
    v.addScaledVector(n, (d - 0.5) * 2 * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ noise
// Cheap value noise (hash lattice + smooth interpolation) — deterministic,
// no tables to allocate per call.
function vhash(x, y, z = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }

export function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = vhash(xi, yi), b = vhash(xi + 1, yi);
  const c = vhash(xi, yi + 1), d = vhash(xi + 1, yi + 1);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

export function fbm2(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += vnoise2(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
  return v;
}

export function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const l = (x0, y0, z0) => vhash(x0, y0, z0);
  const v00 = lerp(l(xi, yi, zi), l(xi + 1, yi, zi), xf);
  const v10 = lerp(l(xi, yi + 1, zi), l(xi + 1, yi + 1, zi), xf);
  const v01 = lerp(l(xi, yi, zi + 1), l(xi + 1, yi, zi + 1), xf);
  const v11 = lerp(l(xi, yi + 1, zi + 1), l(xi + 1, yi + 1, zi + 1), xf);
  return lerp(lerp(v00, v10, yf), lerp(v01, v11, yf), zf);
}

export function fbm3(x, y, z, oct = 3) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += vnoise3(x * f, y * f, z * f) * amp; amp *= 0.5; f *= 2; }
  return v;
}
