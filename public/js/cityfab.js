import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ===========================================================================
// CITYFAB — client visual construction of the district.
//
// The server sends zoned defs (archetype, tiers, per-building seed); this
// module turns them into a coherent city: distinct facade materials per
// district, setback towers, rooftop clutter, road markings, traffic
// signals, parked human-scale vehicles, waterfront cranes — all merged or
// instanced into a handful of draw calls.
// ===========================================================================

export function hashStr(s) {
  let h = 9;
  for (let i = 0; i < String(s).length; i++) h = Math.imul(h ^ String(s).charCodeAt(i), 387420489);
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

// UVs tiled in WORLD units so facade sheets never stretch into blur.
export function worldUVBox(geo, w, h, d, tileW = 12, tileH = 24) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    let su = 1, sv = 1;
    if (face === 0 || face === 1) { su = d / tileW; sv = h / tileH; }
    else if (face === 2 || face === 3) { su = w / tileW; sv = d / tileW; }
    else { su = w / tileW; sv = h / tileH; }
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------
// facade texture sheets — one per district archetype
// ---------------------------------------------------------------------------
function facadeSheet(arch) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 512;
  const ctx = cv.getContext('2d');
  // parallel emissive sheet: ONLY the lit windows, so they glow at night
  // no matter how dark the wall tint is
  const ecv = document.createElement('canvas');
  ecv.width = 256; ecv.height = 512;
  const ectx = ecv.getContext('2d');
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, 256, 512);
  const cfg = {
    glass: { base: '#a9bccb', mullion: 'rgba(26,32,50,0.75)', litW: '#ffe9b0', litC: '#9fd4ff', litRate: 0.30, bayW: 32, bayH: 64, winW: 26, winH: 50, slab: 4, dark: 'rgba(24,34,56,0.85)' },
    concrete: { base: '#c9c6bd', mullion: 'rgba(40,44,60,0.6)', litW: '#ffe9b0', litC: '#cfe0ff', litRate: 0.20, bayW: 32, bayH: 64, winW: 20, winH: 36, slab: 7, dark: 'rgba(22,26,44,0.72)' },
    brick: { base: '#cbb3a2', mullion: 'rgba(52,38,32,0.6)', litW: '#ffd98f', litC: '#ffcea0', litRate: 0.24, bayW: 42, bayH: 64, winW: 18, winH: 32, slab: 5, dark: 'rgba(30,26,38,0.7)' },
    industrial: { base: '#b3b3ab', mullion: 'rgba(40,42,48,0.55)', litW: '#cfe5a0', litC: '#e8f2c0', litRate: 0.10, bayW: 64, bayH: 128, winW: 44, winH: 30, slab: 6, dark: 'rgba(28,30,38,0.6)' },
  }[arch];

  ctx.fillStyle = cfg.base;
  ctx.fillRect(0, 0, 256, 512);
  // material mottle + weather streaks
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${70 + Math.random() * 80},${70 + Math.random() * 80},${80 + Math.random() * 80},0.05)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 512, 4 + Math.random() * 14, 4 + Math.random() * 14);
  }
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = 'rgba(48,52,66,0.09)';
    ctx.fillRect(Math.random() * 256, Math.random() * 220, 2 + Math.random() * 4, 120 + Math.random() * 250);
  }
  if (arch === 'brick') { // course lines
    ctx.fillStyle = 'rgba(90,62,50,0.18)';
    for (let y = 0; y < 512; y += 7) ctx.fillRect(0, y, 256, 1.2);
  }
  if (arch === 'industrial') { // corrugation
    ctx.fillStyle = 'rgba(70,72,78,0.22)';
    for (let x = 0; x < 256; x += 7) ctx.fillRect(x, 0, 2, 512);
  }
  // floor slabs
  for (let y = 0; y < 512; y += cfg.bayH) {
    ctx.fillStyle = 'rgba(38,42,60,0.5)';
    ctx.fillRect(0, y, 256, cfg.slab);
  }
  // window bays
  const rng = mulberry32(hashStr(arch) + 7);
  for (let y = 10; y < 500; y += cfg.bayH) {
    for (let x = (cfg.bayW - cfg.winW) / 2; x < 250; x += cfg.bayW) {
      const r = rng();
      let lit = null;
      if (r < cfg.litRate * 0.6) { ctx.fillStyle = cfg.litW; lit = cfg.litW; }
      else if (r < cfg.litRate) { ctx.fillStyle = cfg.litC; lit = cfg.litC; }
      else if (r < cfg.litRate + 0.08) { ctx.fillStyle = 'rgba(255,230,180,0.30)'; lit = 'rgba(180,150,100,0.5)'; }
      else ctx.fillStyle = cfg.dark;
      ctx.fillRect(x, y + 8, cfg.winW, cfg.winH);
      if (lit) { ectx.fillStyle = lit; ectx.fillRect(x, y + 8, cfg.winW, cfg.winH); }
      ctx.fillStyle = cfg.mullion;
      ctx.fillRect(x + cfg.winW / 2 - 1, y + 8, 2.4, cfg.winH);
      if (arch !== 'glass') ctx.fillRect(x, y + 8 + cfg.winH / 2 - 1, cfg.winW, 2.4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y + 8 + cfg.winH, cfg.winW, 2);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const etex = new THREE.CanvasTexture(ecv);
  etex.colorSpace = THREE.SRGBColorSpace;
  etex.wrapS = etex.wrapT = THREE.RepeatWrapping;
  return { map: tex, emissive: etex };
}

function normalFromHeight(cv, strength = 2.0) {
  const w = cv.width, h = cv.height;
  const src = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const hgt = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (hgt(x - 1, y) - hgt(x + 1, y)) * strength;
      const dy = (hgt(x, y - 1) - hgt(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function facadeNormal() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 32) { ctx.fillStyle = '#9c9c9c'; ctx.fillRect(0, y, 128, 3); }
  for (let y = 7; y < 250; y += 32) {
    for (let x = 5; x < 120; x += 16) { ctx.fillStyle = '#525252'; ctx.fillRect(x, y + 4, 11, 19); }
  }
  return normalFromHeight(cv, 2.4);
}

function asphaltMaps() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#181c28';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 480; i++) {
    ctx.fillStyle = `rgba(${120 + Math.random() * 70},${125 + Math.random() * 70},${140 + Math.random() * 70},0.05)`;
    const s = 4 + Math.random() * 22;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, s, s * (0.4 + Math.random()));
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  ctx.strokeStyle = 'rgba(6,8,14,0.55)';
  ctx.lineWidth = 1.1;
  for (let c = 0; c < 7; c++) {
    let x = Math.random() * 256, y = Math.random() * 256;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) { x += (Math.random() - 0.5) * 42; y += (Math.random() - 0.5) * 42; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;

  const rcv = document.createElement('canvas');
  rcv.width = rcv.height = 128;
  const rctx = rcv.getContext('2d');
  rctx.fillStyle = '#9a9a9a';
  rctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    rctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    rctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  for (let p = 0; p < 9; p++) {
    const px = Math.random() * 128, py = Math.random() * 128;
    for (let b = 0; b < 6; b++) {
      rctx.fillStyle = 'rgba(28,28,28,0.5)';
      rctx.beginPath();
      rctx.ellipse(px + (Math.random() - 0.5) * 16, py + (Math.random() - 0.5) * 16,
        4 + Math.random() * 9, 3 + Math.random() * 6, Math.random() * 3, 0, Math.PI * 2);
      rctx.fill();
    }
  }
  const roughMap = new THREE.CanvasTexture(rcv);

  const ncv = document.createElement('canvas');
  ncv.width = ncv.height = 128;
  const nctx = ncv.getContext('2d');
  nctx.fillStyle = '#828282';
  nctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1600; i++) {
    nctx.fillStyle = Math.random() < 0.5 ? '#8e8e8e' : '#747474';
    nctx.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
  }
  const normalMap = normalFromHeight(ncv, 1.6);
  return { map, roughMap, normalMap };
}

function adTexture(variant) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  const hue = ['#ff5da2', '#4dfff0', '#ffe14d'][variant % 3];
  const dim = ['#7a2450', '#1d7a72', '#7a6a1d'][variant % 3];
  ctx.fillStyle = '#07080e';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = hue; ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, 240, 112);
  let x = 26;
  const seed = mulberry32(9000 + variant);
  for (let i = 0; i < 7 && x < 210; i++) {
    const gw = 14 + seed() * 18;
    ctx.fillStyle = seed() < 0.75 ? hue : dim;
    if (seed() < 0.5) ctx.fillRect(x, 30, gw, 42);
    else { ctx.fillRect(x, 30, gw, 12); ctx.fillRect(x, 58, gw, 14); }
    x += gw + 10;
  }
  ctx.fillStyle = dim;
  ctx.fillRect(26, 88, 160 + seed() * 40, 10);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
export class CityTextures {
  constructor(renderer) {
    const aniso = renderer.capabilities.getMaxAnisotropy();
    this.facades = {};
    for (const arch of ['glass', 'concrete', 'brick', 'industrial']) {
      const t = facadeSheet(arch);
      t.map.anisotropy = aniso;
      this.facades[arch] = t;
    }
    this.facadeNormal = facadeNormal();
    this.facadeNormal.anisotropy = aniso;
    const a = asphaltMaps();
    this.asphalt = a;
    for (const t of [a.map, a.roughMap, a.normalMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(26, 26);
    }
    a.map.anisotropy = aniso;
    this.ads = [0, 1, 2].map(adTexture);
  }
}

// ---------------------------------------------------------------------------
// per-def builders
// ---------------------------------------------------------------------------
export function buildGround(g, d, tex) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...d.size),
    new THREE.MeshStandardMaterial({
      color: '#5a6478', map: tex.asphalt.map,
      metalness: 0.72, roughness: 1.0, roughnessMap: tex.asphalt.roughMap,
      normalMap: tex.asphalt.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      envMapIntensity: 1.25,
    })
  );
  mesh.position.set(...d.p);
  mesh.receiveShadow = true;
  g.add(mesh);
}

// building body: tiered towers merge their setbacks into one geometry
export function buildingBodyGeo(d) {
  const [w, h, dd] = d.size;
  if (!d.tiers) {
    const box = worldUVBox(new THREE.BoxGeometry(w, h, dd), w, h, dd);
    if (d.yaw) box.rotateY(d.yaw);
    box.translate(...d.p);
    return box;
  }
  const parts = [];
  const baseY = d.p[1] - h / 2;
  let ty = baseY;
  for (const [scale, frac] of d.tiers) {
    const th = h * frac;
    const g = worldUVBox(new THREE.BoxGeometry(w * scale, th, dd * scale), w * scale, th, dd * scale);
    g.translate(d.p[0], ty + th / 2, d.p[2]);
    parts.push(g);
    // ledge trim at each setback
    const ledge = new THREE.BoxGeometry(w * scale + 0.8, 0.6, dd * scale + 0.8);
    ledge.translate(d.p[0], ty + th, d.p[2]);
    parts.push(worldUVBox(ledge, w * scale + 0.8, 0.6, dd * scale + 0.8));
    ty += th;
  }
  return mergeGeometries(parts);
}

export function buildingRoofGeo(d) {
  const topScale = d.tiers ? d.tiers[d.tiers.length - 1][0] : 1;
  const topFrac = d.tiers ? d.tiers.reduce((a, t) => a + t[1], 0) : 1;
  const [w, h, dd] = d.size;
  const rf = new THREE.BoxGeometry(w * topScale + 0.7, 0.8, dd * topScale + 0.7);
  if (d.yaw) rf.rotateY(d.yaw);
  rf.translate(d.p[0], d.p[1] - h / 2 + h * topFrac + 0.4, d.p[2]);
  return rf;
}

// rooftop clutter + facade neon into the building's deco group
export function decorateBuilding(deco, d, tex, matBank) {
  const rng = mulberry32(d.v ?? hashStr(d.p[0] + ',' + d.p[2]));
  const topScale = d.tiers ? d.tiers[d.tiers.length - 1][0] : 1;
  const topFrac = d.tiers ? d.tiers.reduce((a, t) => a + t[1], 0) : 1;
  const topY = d.p[1] - d.size[1] / 2 + d.size[1] * topFrac;
  const [w, , dd] = d.size;
  const geosDark = [], geosMetal = [];
  const push = (arr, geo, x, y, z, ry = 0) => { if (ry) geo.rotateY(ry); geo.translate(x, y, z); arr.push(geo); };

  const roll = rng();
  if (roll < 0.24 && d.arch !== 'industrial') {
    // water tower on legs
    const tw = new THREE.CylinderGeometry(1.5, 1.7, 2.8, 9);
    push(geosMetal, tw, d.p[0] + (rng() - 0.5) * w * 0.3 * topScale, topY + 2.6, d.p[2] + (rng() - 0.5) * dd * 0.3);
    const lid = new THREE.ConeGeometry(1.9, 1.1, 9);
    push(geosMetal, lid, geosMetal[geosMetal.length - 1] ? d.p[0] : d.p[0], topY + 4.55, d.p[2]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      push(geosDark, new THREE.CylinderGeometry(0.1, 0.1, 2.2), d.p[0] + Math.cos(a) * 1.1, topY + 1.1, d.p[2] + Math.sin(a) * 1.1);
    }
  } else if (roll < 0.55) {
    // HVAC units + duct run
    const nAC = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < nAC; i++) {
      push(geosDark, new THREE.BoxGeometry(1.8 + rng(), 1.1, 1.8 + rng()),
        d.p[0] + (rng() - 0.5) * w * 0.5 * topScale, topY + 0.6, d.p[2] + (rng() - 0.5) * dd * 0.5 * topScale, rng());
    }
    push(geosMetal, new THREE.CylinderGeometry(0.28, 0.28, 2 + rng() * 2), d.p[0] + (rng() - 0.5) * w * 0.4, topY + 1.4, d.p[2] + (rng() - 0.5) * dd * 0.4);
  } else if (roll < 0.75) {
    // antenna cluster
    const nA = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < nA; i++) {
      push(geosDark, new THREE.CylinderGeometry(0.07, 0.12, 4 + rng() * 3),
        d.p[0] + (rng() - 0.5) * w * 0.4 * topScale, topY + 2.4, d.p[2] + (rng() - 0.5) * dd * 0.4 * topScale);
    }
  }
  // parapet edge on most roofs
  if (rng() < 0.8) {
    const pw = w * topScale + 0.4, pd = dd * topScale + 0.4;
    push(geosDark, new THREE.BoxGeometry(pw, 0.5, 0.35), d.p[0], topY + 0.25, d.p[2] - pd / 2);
    push(geosDark, new THREE.BoxGeometry(pw, 0.5, 0.35), d.p[0], topY + 0.25, d.p[2] + pd / 2);
    push(geosDark, new THREE.BoxGeometry(0.35, 0.5, pd), d.p[0] - pw / 2, topY + 0.25, d.p[2]);
    push(geosDark, new THREE.BoxGeometry(0.35, 0.5, pd), d.p[0] + pw / 2, topY + 0.25, d.p[2]);
  }
  if (geosDark.length) {
    const m = new THREE.Mesh(mergeGeometries(geosDark), matBank.roofDark);
    m.castShadow = true;
    deco.add(m);
  }
  if (geosMetal.length) {
    const m = new THREE.Mesh(mergeGeometries(geosMetal), matBank.roofMetal);
    m.castShadow = true;
    deco.add(m);
  }
  // ground-floor entrance: a lit doorway (human scale cue) on street face
  if (d.arch !== 'industrial' && rng() < 0.75) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), matBank.doorGlow);
    door.position.set(d.p[0] + (rng() - 0.5) * w * 0.5, d.p[1] - d.size[1] / 2 + 1.6, d.p[2] + dd / 2 + 0.06);
    deco.add(door);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.1), matBank.roofDark);
    awning.position.set(door.position.x, d.p[1] - d.size[1] / 2 + 3.4, d.p[2] + dd / 2 + 0.5);
    deco.add(awning);
  }
  // facade neon strip
  if ((d.v ?? 0) % 3 === 0 && d.size[1] > 14 && d.arch !== 'industrial') {
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(6, d.size[0] * 0.6), 1.1, 0.25),
      new THREE.MeshBasicMaterial({ color: ['#ff5da2', '#4dfff0', '#ffe14d', '#8aff6b'][(d.v ?? 0) % 4] })
    );
    neon.position.set(d.p[0], d.p[1] - d.size[1] * 0.32, d.p[2] + d.size[2] / 2 + 0.2);
    deco.add(neon);
  }
}

// road markings: real geometry strips — crisp lane dashes, stop bars,
// crosswalks at every intersection. One merged mesh for the whole grid.
export function buildRoadMarkings(g, grid) {
  const { span, block, start, n, riverX } = grid;
  const dashes = [];
  const white = [];
  const dash = (x, z, w, d) => {
    const p = new THREE.PlaneGeometry(w, d);
    p.rotateX(-Math.PI / 2);
    p.translate(x, 0.06, z);
    dashes.push(p);
  };
  const wstrip = (x, z, w, d) => {
    const p = new THREE.PlaneGeometry(w, d);
    p.rotateX(-Math.PI / 2);
    p.translate(x, 0.06, z);
    white.push(p);
  };
  const half = (n * span) / 2;
  // center dashes along each avenue (both axes)
  for (let i = 0; i <= n; i++) {
    const c = start - span / 2 + i * span - block / 2 + block / 2 + span / 2 - span / 2;
    const aveCenter = start + i * span - span / 2 - block / 2 + block / 2; // between blocks
    const a = start - (span - block) / 2 + i * span - block / 2 + (span - block) / 2 - (span - block) / 2;
    void c; void a;
    const laneC = start + i * span + block / 2 + (span - block) / 2;   // avenue centerline
    if (laneC > half) continue;
    for (let s = -half; s < half; s += 8) {
      if (Math.abs(laneC - riverX) > 14) dash(laneC, s + 2, 0.45, 4);
      const otherC = laneC;
      if (Math.abs(s + 2 - riverX) > 14 || true) dash(s + 2, otherC, 4, 0.45);
    }
  }
  // crosswalks around each intersection
  for (let ix = 0; ix <= n; ix++) {
    for (let iz = 0; iz <= n; iz++) {
      const x = start + ix * span + block / 2 + (span - block) / 2;
      const z = start + iz * span + block / 2 + (span - block) / 2;
      if (x > half || z > half) continue;
      if (Math.abs(x - riverX) < 16) continue;
      if ((ix + iz) % 2 !== 0) continue; // half of them, cheaper
      for (let k = -3; k <= 3; k++) {
        wstrip(x + k * 1.15, z - (span - block) / 2 - 1.2, 0.55, 2.6);
        wstrip(x - (span - block) / 2 - 1.2, z + k * 1.15, 2.6, 0.55);
      }
    }
  }
  if (dashes.length) {
    const m = new THREE.Mesh(mergeGeometries(dashes),
      new THREE.MeshBasicMaterial({ color: '#c9c04d', transparent: true, opacity: 0.4, depthWrite: false }));
    m.renderOrder = 1;
    g.add(m);
  }
  if (white.length) {
    const m = new THREE.Mesh(mergeGeometries(white),
      new THREE.MeshBasicMaterial({ color: '#cfd4de', transparent: true, opacity: 0.35, depthWrite: false }));
    m.renderOrder = 1;
    g.add(m);
  }
}

// streetlights (merged) — poles + sodium heads
export function buildLamps(g, lamps) {
  if (!lamps.length) return;
  const poles = [], heads = [];
  for (const d of lamps) {
    const pole = new THREE.CylinderGeometry(0.14, 0.22, 9, 8);
    pole.translate(d.p[0], 4.5, d.p[2]);
    poles.push(pole);
    const arm = new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(d.p[0] + 1.1, 8.9, d.p[2]);
    poles.push(arm);
    const head = new THREE.BoxGeometry(1.0, 0.3, 0.5);
    head.translate(d.p[0] + 2.2, 8.85, d.p[2]);
    heads.push(head);
  }
  const poleMesh = new THREE.Mesh(mergeGeometries(poles),
    new THREE.MeshStandardMaterial({ color: '#252a36', metalness: 0.8, roughness: 0.45 }));
  poleMesh.castShadow = true;
  g.add(poleMesh);
  const headMesh = new THREE.Mesh(mergeGeometries(heads),
    new THREE.MeshBasicMaterial({ color: '#ffca7a' }));
  g.add(headMesh);
}

// traffic signals: merged poles + per-color lamp meshes
export function buildTraffic(g, defs) {
  if (!defs.length) return;
  const poles = [], red = [], amber = [], green = [];
  for (const d of defs) {
    const [x, , z] = d.p;
    const pole = new THREE.CylinderGeometry(0.1, 0.16, 6.2, 8);
    pole.translate(x, 3.1, z);
    poles.push(pole);
    const arm = new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6);
    arm.rotateZ(Math.PI / 2);
    arm.rotateY(d.yaw || 0);
    arm.translate(x + Math.cos(d.yaw || 0) * 1.5, 5.9, z - Math.sin(d.yaw || 0) * 1.5);
    poles.push(arm);
    const hx = x + Math.cos(d.yaw || 0) * 3.0, hz = z - Math.sin(d.yaw || 0) * 3.0;
    const box = new THREE.BoxGeometry(0.5, 1.35, 0.5);
    box.translate(hx, 5.4, hz);
    poles.push(box);
    const lamp = (arr, dy) => {
      const s = new THREE.SphereGeometry(0.16, 6, 5);
      s.translate(hx, 5.4 + dy, hz - 0.28);
      arr.push(s);
    };
    lamp(red, 0.42); lamp(amber, 0); lamp(green, -0.42);
  }
  const poleMesh = new THREE.Mesh(mergeGeometries(poles),
    new THREE.MeshStandardMaterial({ color: '#1d222c', metalness: 0.7, roughness: 0.5 }));
  g.add(poleMesh);
  // signals glow; most sit on red/amber (evacuated city), a few green
  g.add(new THREE.Mesh(mergeGeometries(red), new THREE.MeshBasicMaterial({ color: '#ff3b30' })));
  if (amber.length) g.add(new THREE.Mesh(mergeGeometries(amber), new THREE.MeshBasicMaterial({ color: '#3a2c14' })));
  if (green.length) g.add(new THREE.Mesh(mergeGeometries(green), new THREE.MeshBasicMaterial({ color: '#14361f' })));
}

// parked vehicles: merged static bodies per color + shared glass/wheel/light
export function buildParked(g, defs) {
  if (!defs.length) return;
  const byColor = {};
  const glass = [], wheels = [], lights = [];
  for (const d of defs) {
    const yaw = d.yaw || 0;
    const [x, , z] = d.p;
    const L = d.type === 'bus' ? 9.5 : d.type === 'van' ? 4.6 : 3.9;
    const H = d.type === 'bus' ? 2.9 : d.type === 'van' ? 2.2 : 1.45;
    const W = d.type === 'bus' ? 2.5 : 1.85;
    const body = new RoundedBoxGeometry(L, H * 0.62, W, 2, 0.16);
    body.rotateY(yaw);
    body.translate(x, H * 0.36, z);
    (byColor[d.color] = byColor[d.color] || []).push(body);
    if (d.type === 'bus') {
      const cab = new RoundedBoxGeometry(L * 0.96, H * 0.42, W * 0.94, 2, 0.12);
      cab.rotateY(yaw);
      cab.translate(x, H * 0.72, z);
      glass.push(cab);
    } else {
      const cab = new RoundedBoxGeometry(L * 0.52, H * 0.5, W * 0.84, 2, 0.12);
      cab.rotateY(yaw);
      cab.translate(x - Math.cos(yaw) * L * 0.05, H * 0.68, z + Math.sin(yaw) * L * 0.05);
      glass.push(cab);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wh = new THREE.CylinderGeometry(H * 0.22, H * 0.22, 0.22, 8);
      wh.rotateX(Math.PI / 2);
      wh.rotateY(yaw);
      const ox = sx * L * 0.32, oz = sz * (W / 2);
      wh.translate(x + Math.cos(yaw) * ox + Math.sin(yaw) * oz, H * 0.2, z - Math.sin(yaw) * ox + Math.cos(yaw) * oz);
      wheels.push(wh);
    }
    const tail = new THREE.BoxGeometry(0.12, 0.12, W * 0.7);
    tail.rotateY(yaw);
    tail.translate(x - Math.cos(yaw) * L * 0.5, H * 0.3, z + Math.sin(yaw) * L * 0.5);
    lights.push(tail);
  }
  for (const [color, geos] of Object.entries(byColor)) {
    const m = new THREE.Mesh(mergeGeometries(geos),
      new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.32, envMapIntensity: 1.2 }));
    m.castShadow = true;
    g.add(m);
  }
  g.add(new THREE.Mesh(mergeGeometries(glass),
    new THREE.MeshStandardMaterial({ color: '#0e1a26', metalness: 0.4, roughness: 0.12, envMapIntensity: 1.5 })));
  g.add(new THREE.Mesh(mergeGeometries(wheels),
    new THREE.MeshStandardMaterial({ color: '#15161c', metalness: 0.3, roughness: 0.85 })));
  g.add(new THREE.Mesh(mergeGeometries(lights), new THREE.MeshBasicMaterial({ color: '#5c1c1c' })));
}

// harbor crane at the waterfront
export function buildCrane(g, d) {
  const grp = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#7a5c30', metalness: 0.6, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#33363f', metalness: 0.7, roughness: 0.5 });
  const legG = new THREE.BoxGeometry(1.1, 22, 1.1);
  for (const [sx, sz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
    const leg = new THREE.Mesh(legG, steel);
    leg.position.set(sx, 11, sz);
    grp.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 1.6, 8), dark);
  deck.position.y = 22.6;
  grp.add(deck);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 26), steel);
  jib.position.set(0, 24, -8);
  grp.add(jib);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), dark);
  cab.position.set(0, 24.8, 2);
  grp.add(cab);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9), dark);
  cable.position.set(0, 19, -17);
  grp.add(cable);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), steel);
  hook.position.set(0, 14, -17);
  grp.add(hook);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
  beacon.position.set(0, 25.6, -20.5);
  grp.add(beacon);
  grp.position.set(d.p[0], 0, d.p[2]);
  grp.rotation.y = d.yaw || 0;
  grp.traverse((m) => { m.castShadow = true; });
  g.add(grp);
}

// distant skyline ring: layered silhouettes with sparse lit windows
export function buildSkyline(scene) {
  const silGeos = [];
  const winPts = [];
  const rng0 = mulberry32(3);
  for (let ring = 0; ring < 2; ring++) {
    const r = 230 + ring * 100;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + ring * 0.07;
      const h = 30 + rng0() * (65 + ring * 45);
      const w = 18 + rng0() * 26;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const gBox = new THREE.BoxGeometry(w, h, w);
      gBox.translate(x, h / 2 - 4, z);
      silGeos.push(gBox);
      // sparse lit windows on the near ring
      if (ring === 0) {
        const nW = Math.floor(rng0() * 8);
        for (let k = 0; k < nW; k++) {
          winPts.push(x + (rng0() - 0.5) * w * 0.8, 4 + rng0() * h * 0.85, z + (rng0() - 0.5) * w * 0.8);
        }
      }
    }
  }
  const sil = new THREE.Mesh(mergeGeometries(silGeos),
    new THREE.MeshBasicMaterial({ color: '#1d2440', fog: false }));
  sil.frustumCulled = false;
  scene.add(sil);
  let pts = null;
  if (winPts.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(winPts), 3));
    pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffca7a', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false }));
    pts.frustumCulled = false;
    scene.add(pts);
  }
  return { sil, pts };
}

export function makeMatBank() {
  return {
    roofDark: new THREE.MeshStandardMaterial({ color: '#2b2e38', metalness: 0.4, roughness: 0.8 }),
    roofMetal: new THREE.MeshStandardMaterial({ color: '#6b5a48', metalness: 0.7, roughness: 0.5 }),
    doorGlow: new THREE.MeshBasicMaterial({ color: '#ffe0a3' }),
  };
}
