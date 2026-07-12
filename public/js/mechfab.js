import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ===========================================================================
// MECHFAB — the original kitbash part library + modular mech factory.
//
// Every visible part is authored here from beveled extrusions, lathes,
// chamfered plates, piston stacks, vent banks and cable runs — merged per
// articulation node so a full mech is ~50 draw calls, not 500. No bare
// engine primitive is left visible: every silhouette is a designed shape.
//
// buildMech({ build, up }) returns:
//   root      THREE.Group (place at the mech body position)
//   nodes     named articulation joints (head, chest, arms, legs, sockets)
//   mats      shared materials (recolored live for paint changes)
//   setUpgrades(up)  swap the visible run-upgrade attachments
//   dispose()
// ===========================================================================

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// small geometry authoring helpers
// ---------------------------------------------------------------------------

// Chamfered armor plate from a 2D outline (points in the XY plane, meters),
// extruded `depth` with a real bevel — the single most important tool for
// killing the "raw box" read.
function plateGeo(pts, depth, bevel = 0.08) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// symmetric hexagonal / coffin plate outlines
function hexPlate(w, h, depth, cut = 0.3, bevel = 0.08) {
  const cx = w / 2, cy = h / 2, c = Math.min(cut, cx * 0.9, cy * 0.9);
  return plateGeo([
    [-cx + c, -cy], [cx - c, -cy], [cx, -cy + c], [cx, cy - c],
    [cx - c, cy], [-cx + c, cy], [-cx, cy - c], [-cx, -cy + c],
  ], depth, bevel);
}
function wedgePlate(w, h, depth, taper = 0.6, bevel = 0.08) {
  const cx = w / 2, cy = h / 2;
  return plateGeo([[-cx * taper, cy], [cx * taper, cy], [cx, -cy], [-cx, -cy]], depth, bevel);
}

function rbox(w, h, d, r = 0.09) {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
}

// Lathe profile: array of [radius, y]. Smooth-shaded revolution — hydraulic
// cylinders, actuator collars, thruster bells, sensor domes.
function latheGeo(profile, seg = 18) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

// piston: bright rod inside a darker sleeve with collar rings
function pistonGeo(len, r = 0.09) {
  return latheGeo([[r, 0], [r, len]], 10);
}
function sleeveGeo(len, r = 0.14) {
  return latheGeo([[r, 0], [r * 1.25, 0.04], [r * 1.25, len * 0.42], [r, len * 0.5], [r, len]], 12);
}

// vent bank: n thin louvre fins
function ventGeo(n, w, h, d, gap) {
  const fins = [];
  for (let i = 0; i < n; i++) {
    const f = rbox(w, h, d, Math.min(0.03, h / 2.5));
    f.translate(0, -i * (h + gap), 0);
    fins.push(f);
  }
  return mergeGeometries(fins);
}

// cable run: catenary tube between two local points
function cableGeo(a, b, sag = 0.35, r = 0.05) {
  const mid = new V3().addVectors(a, b).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.CatmullRomCurve3([a, mid, b]);
  return new THREE.TubeGeometry(curve, 8, r, 6);
}

function T(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  if (s !== 1) geo.scale(s, s, s);
  geo.translate(x, y, z);
  return geo;
}

// ---------------------------------------------------------------------------
// Kit: collects geometry into (node, material-slot) buckets, then bakes each
// bucket into ONE mesh. Articulation stays cheap; silhouettes stay rich.
// ---------------------------------------------------------------------------
class Kit {
  constructor() { this.buckets = new Map(); }
  add(node, slot, geo) {
    const key = node + '|' + slot;
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(geo);
  }
  bake(nodes, mats, shadows = true) {
    const meshes = [];
    for (const [key, geos] of this.buckets) {
      const [node, slot] = key.split('|');
      const merged = mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g));
      const mesh = new THREE.Mesh(merged, mats[slot]);
      mesh.castShadow = shadows && slot !== 'emissive' && slot !== 'glow';
      mesh.receiveShadow = shadows;
      nodes[node].add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

// ---------------------------------------------------------------------------
// weathering: shared grunge sheet (multiplied into hull color + roughness)
// ---------------------------------------------------------------------------
let _grungeCache = null;
function grungeTexture() {
  if (_grungeCache) return _grungeCache;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const g = 150 + Math.random() * 90;
    ctx.fillStyle = `rgba(${g},${g},${g},0.16)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 22, 1 + Math.random() * 4);
  }
  for (let i = 0; i < 46; i++) { // vertical rain streaks
    const x = Math.random() * 256;
    ctx.fillStyle = 'rgba(90,92,100,0.10)';
    ctx.fillRect(x, Math.random() * 130, 1.5 + Math.random() * 3, 40 + Math.random() * 140);
  }
  for (let i = 0; i < 60; i++) { // chipped edges: light nicks
    ctx.fillStyle = 'rgba(235,235,240,0.35)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }
  _grungeCache = new THREE.CanvasTexture(cv);
  _grungeCache.wrapS = _grungeCache.wrapT = THREE.RepeatWrapping;
  return _grungeCache;
}

// decal sheets — original markings only
function decalTexture(kind, accent) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  if (kind === 'stripes') {
    for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(18 + i * 26, 0); ctx.transform(1, 0, -0.35, 1, 0, 0); ctx.fillRect(0, 10, 12, 108); ctx.restore(); }
  } else if (kind === 'digits') {
    ctx.font = 'bold 78px "Arial Black", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('07', 64, 66);
    ctx.fillRect(14, 108, 100, 6);
  } else if (kind === 'wedge') {
    ctx.beginPath(); ctx.moveTo(64, 14); ctx.lineTo(114, 106); ctx.lineTo(14, 106); ctx.closePath();
    ctx.lineWidth = 10; ctx.stroke();
    ctx.fillRect(52, 58, 24, 30);
  } else if (kind === 'crest') {
    ctx.beginPath(); ctx.arc(64, 58, 42, 0, Math.PI * 2); ctx.lineWidth = 8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, 26); ctx.lineTo(88, 78); ctx.lineTo(40, 78); ctx.closePath(); ctx.fill();
    ctx.fillRect(30, 92, 68, 8);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// materials from paint
// ---------------------------------------------------------------------------
export function mechMaterials(paint) {
  const grunge = grungeTexture();
  const rough = 0.28 + (1 - (paint.finish ?? 0.3)) * 0.34;
  const weather = paint.weathering ?? 0.4;
  const mk = (color, metal, r) => new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: r,
    map: weather > 0.05 ? grunge : null,
    envMapIntensity: 1.5,
  });
  const mats = {
    hull: mk(paint.primary, 0.62, rough),
    panel: mk(paint.secondary, 0.68, rough * 0.92),
    accent: mk(paint.accent, 0.45, rough * 1.05),
    dark: new THREE.MeshStandardMaterial({ color: '#23262e', metalness: 0.85, roughness: 0.42, envMapIntensity: 1.0 }),
    steel: new THREE.MeshStandardMaterial({ color: '#cfd4de', metalness: 1.0, roughness: 0.16, envMapIntensity: 1.5 }),
    tread: new THREE.MeshStandardMaterial({ color: '#17181d', metalness: 0.4, roughness: 0.8 }),
    emissive: new THREE.MeshStandardMaterial({
      color: '#0a0d16', metalness: 0.4, roughness: 0.4,
      emissive: new THREE.Color(paint.emissive), emissiveIntensity: 2.6,
    }),
    glow: new THREE.MeshBasicMaterial({ color: paint.emissive }),
  };
  // weathering also dirties the roughness so worn hulls go matte in patches
  if (weather > 0.05) {
    mats.hull.roughnessMap = grunge;
    mats.panel.roughnessMap = grunge;
  }
  return mats;
}

export function applyPaint(mats, paint) {
  mats.hull.color.set(paint.primary);
  mats.panel.color.set(paint.secondary);
  mats.accent.color.set(paint.accent);
  mats.emissive.emissive.set(paint.emissive);
  mats.glow.color.set(paint.emissive);
  const rough = 0.28 + (1 - (paint.finish ?? 0.3)) * 0.34;
  mats.hull.roughness = rough;
  mats.panel.roughness = rough * 0.92;
}

// ===========================================================================
// PART BUILDERS — each writes into the kit under a node + material slot.
// Local frames: node origin at the joint pivot, -Z forward, +Y up.
// ===========================================================================

// widths per frame class
const FRAME_P = {
  vanguard: { w: 0.88, plate: 0, squat: 1.03, pauldron: 0.85 },
  warden: { w: 1.0, plate: 1, squat: 1.0, pauldron: 1.0 },
  bastion: { w: 1.16, plate: 2, squat: 0.95, pauldron: 1.25 },
};

function buildTorso(kit, P, torsoId) {
  const w = P.w;
  // --- chest: layered sculpted mass, not a box ---
  // core ribcage block (dark, mostly hidden)
  kit.add('chest', 'dark', T(rbox(3.6 * w, 2.5, 2.3, 0.3), 0, 1.15, 0));
  // main chest plates: two angled pectoral slabs meeting at a center ridge
  for (const s of [-1, 1]) {
    kit.add('chest', 'hull', T(hexPlate(2.0 * w, 1.7, 0.5, 0.5, 0.1), s * 1.12 * w, 1.45, -1.18, 0.14, s * 0.24, s * 0.06));
    // clavicle intake above each pec
    kit.add('chest', 'dark', T(ventGeo(3, 0.9 * w, 0.09, 0.3, 0.07), s * 1.15 * w, 2.42, -0.95, 0.5));
    // side torso armor skirts
    kit.add('chest', 'panel', T(wedgePlate(1.5, 2.0, 0.42, 0.72, 0.09), s * (2.05 * w), 0.9, 0.1, 0, s * Math.PI / 2, 0));
  }
  // center ridge spine plate
  kit.add('chest', 'panel', T(wedgePlate(0.75, 1.9, 0.55, 0.5, 0.09), 0, 1.5, -1.25, 0.12));
  // collar ring behind the head
  kit.add('chest', 'dark', T(latheGeo([[0.75, 0], [0.95, 0.12], [0.95, 0.4], [0.8, 0.5]], 14), 0, 2.55, -0.1));
  // abdomen: stacked flex segments tapering to the waist
  for (let i = 0; i < 3; i++) {
    kit.add('chest', i % 2 ? 'dark' : 'panel',
      T(latheGeo([[1.35 * w - i * 0.13, 0], [1.5 * w - i * 0.14, 0.18], [1.42 * w - i * 0.14, 0.42]], 12), 0, -0.4 - i * 0.44, 0.1));
  }
  // back: power spine + cooling stack
  kit.add('chest', 'dark', T(rbox(1.7 * w, 2.4, 0.7, 0.16), 0, 1.2, 1.35));
  kit.add('chest', 'panel', T(hexPlate(2.6 * w, 2.0, 0.4, 0.5), 0, 1.3, 1.62, -0.08));
  for (const s of [-1, 1]) {
    kit.add('chest', 'dark', T(ventGeo(4, 0.7, 0.1, 0.35, 0.08), s * 0.95 * w, 1.9, 1.85, 0.35));
    // hip cable runs
    kit.add('chest', 'tread', cableGeo(new V3(s * 1.35 * w, -0.4, 0.9), new V3(s * 1.1 * w, -1.5, 0.55), 0.3, 0.06));
  }

  // --- torso variant character ---
  if (torsoId === 'aegis') {
    // reactor iris: recessed ring + emissive core
    kit.add('chest', 'dark', T(latheGeo([[0.28, 0], [0.62, 0.05], [0.68, 0.22], [0.5, 0.3]], 18), 0, 1.0, -1.32, Math.PI / 2));
    kit.add('chest', 'emissive', T(latheGeo([[0.02, 0], [0.3, 0.02], [0.34, 0.14]], 16), 0, 1.0, -1.36, Math.PI / 2));
  } else if (torsoId === 'furnace') {
    // overdriven plant: twin radiator towers + hot exhaust stacks
    for (const s of [-1, 1]) {
      kit.add('chest', 'dark', T(rbox(0.5, 1.5, 0.7, 0.1), s * 0.9 * w, 2.2, 1.7));
      kit.add('chest', 'emissive', T(ventGeo(5, 0.34, 0.08, 0.55, 0.1), s * 0.9 * w, 2.6, 1.72));
      kit.add('chest', 'steel', T(latheGeo([[0.14, 0], [0.18, 0.5], [0.15, 0.8]], 10), s * 0.5 * w, 2.9, 1.5));
    }
    kit.add('chest', 'emissive', T(hexPlate(0.9, 0.5, 0.18, 0.2), 0, 0.95, -1.4, 0.1));
  } else if (torsoId === 'rampart') {
    // armoured vault: extra sloped glacis slabs over the whole chest
    kit.add('chest', 'hull', T(wedgePlate(3.3 * w, 1.4, 0.5, 0.8, 0.12), 0, 1.9, -1.45, 0.35));
    kit.add('chest', 'panel', T(wedgePlate(2.7 * w, 1.0, 0.45, 0.85, 0.1), 0, 0.6, -1.5, -0.15));
    kit.add('chest', 'emissive', T(rbox(0.5, 0.16, 0.1), 0, 1.35, -1.62));
  }

  // pelvis block + hip skirt plates
  kit.add('pelvis', 'dark', T(rbox(2.2 * w, 1.15, 1.5, 0.2), 0, 0, 0));
  kit.add('pelvis', 'hull', T(wedgePlate(1.15 * w, 1.15, 0.4, 0.62, 0.09), 0, -0.25, -0.85, 0.18));
  for (const s of [-1, 1]) {
    kit.add('pelvis', 'panel', T(wedgePlate(0.85, 1.3, 0.36, 0.55, 0.08), s * 1.35 * w, -0.35, 0, 0.06, s * Math.PI / 2, s * 0.12));
  }
  kit.add('pelvis', 'accent', T(rbox(1.5 * w, 0.16, 0.1), 0, 0.32, -0.83));
}

function buildHead(kit, P, headId) {
  // shared cranium: faceted, small against the chest (scale cue)
  kit.add('head', 'dark', T(latheGeo([[0.34, -0.3], [0.52, -0.18], [0.56, 0.28], [0.34, 0.5], [0.12, 0.56]], 8), 0, 0.1, 0));
  kit.add('head', 'hull', T(hexPlate(0.95, 0.55, 0.5, 0.22, 0.06), 0, 0.42, -0.1, -0.5)); // crown plate
  for (const s of [-1, 1]) kit.add('head', 'panel', T(rbox(0.16, 0.34, 0.5, 0.05), s * 0.52, 0.05, 0.05)); // cheek comms

  if (headId === 'oracle') {
    // wide-band sensor array: quad lens cluster + whip antennas + mini dish
    kit.add('head', 'dark', T(rbox(0.95, 0.4, 0.4, 0.08), 0, 0.02, -0.42));
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      kit.add('head', 'glow', T(latheGeo([[0.02, 0], [0.085, 0.02], [0.1, 0.1]], 10), s * (0.18 + i * 0.24), 0.04, -0.62, Math.PI / 2));
    }
    kit.add('head', 'steel', T(pistonGeo(0.75, 0.02), 0.3, 0.5, 0.25, -0.25));
    kit.add('head', 'steel', T(pistonGeo(0.55, 0.02), -0.34, 0.5, 0.25, -0.15));
    kit.add('head', 'dark', T(latheGeo([[0.02, 0], [0.2, 0.05], [0.22, 0.08]], 10), -0.34, 0.62, 0.1, 0.9));
  } else if (headId === 'cyclops') {
    // heavy single optic: brow slab + one wide visor + emitter chin barrel
    kit.add('head', 'panel', T(wedgePlate(1.15, 0.4, 0.45, 0.75, 0.06), 0, 0.34, -0.5, 0.4));
    kit.add('head', 'glow', T(rbox(0.8, 0.15, 0.12, 0.05), 0, 0.03, -0.58));
    kit.add('head', 'dark', T(latheGeo([[0.1, 0], [0.16, 0.05], [0.16, 0.4], [0.1, 0.44]], 12), 0, -0.28, -0.5, Math.PI / 2));
    kit.add('head', 'emissive', T(latheGeo([[0.02, 0], [0.09, 0.05]], 10), 0, -0.28, -0.72, Math.PI / 2));
  } else { // talon
    // fire-control visor: hawk beak + twin slit optics + chin pod
    kit.add('head', 'hull', T(wedgePlate(0.8, 0.75, 0.4, 0.35, 0.06), 0, 0.06, -0.55, 1.15));
    for (const s of [-1, 1]) kit.add('head', 'glow', T(T(rbox(0.3, 0.09, 0.1, 0.03), 0, 0, 0, 0, 0, -s * 0.22), s * 0.26, 0.12, -0.52));
    kit.add('head', 'dark', T(rbox(0.34, 0.22, 0.4, 0.06), 0, -0.34, -0.35));
    kit.add('head', 'glow', T(latheGeo([[0.02, 0], [0.05, 0.05]], 8), 0, -0.34, -0.58, Math.PI / 2));
  }
}

function buildPauldron(kit, P, node, side, frameId) {
  const s = side === 'L' ? -1 : 1;
  const k = P.pauldron;
  // layered pauldron: outer sloped shell over an inner cap, front chamfer
  kit.add(node, 'hull', T(hexPlate(1.6 * k, 1.9 * k, 1.1, 0.45, 0.1), s * 0.32, 0.1, 0, 0.06, s * Math.PI / 2, s * -0.18));
  kit.add(node, 'panel', T(hexPlate(1.3 * k, 1.5 * k, 0.5, 0.4, 0.08), s * 0.78, 0.28, 0, 0, s * Math.PI / 2, s * -0.18));
  kit.add(node, 'dark', T(latheGeo([[0.42, 0], [0.5, 0.1], [0.5, 0.5], [0.4, 0.6]], 12), 0, -0.12, 0, 0, 0, s * Math.PI / 2)); // shoulder actuator drum
  kit.add(node, 'accent', T(rbox(0.08, 1.2 * k, 0.9, 0.03), s * (1.02 * k + 0.12), 0.28, 0)); // ID stripe
  if (frameId === 'bastion') {
    kit.add(node, 'hull', T(wedgePlate(1.15, 0.8, 0.5, 0.6, 0.09), s * 0.4, 1.0 * k, 0, -0.35, s * 0.15));
  }
  // marker light
  kit.add(node, 'glow', T(rbox(0.14, 0.1, 0.1, 0.03), s * 0.55, 0.55 * k, -0.55));
}

// arm: upperArm node (pivot at shoulder), foreArm node (pivot at elbow),
// fist node (pivot at wrist). Bone lengths returned for the IK.
function buildArm(kit, P, side, armId) {
  const s = side === 'L' ? -1 : 1;
  const U = 'upperArm' + side, F = 'foreArm' + side, H = 'fist' + side;
  const upperLen = 2.05, foreLen = 2.3;

  // ---- upper arm: bicep housing + twin support pistons ----
  kit.add(U, 'dark', T(latheGeo([[0.3, 0], [0.42, 0.25], [0.4, 1.1], [0.34, 1.4]], 12), 0, -1.55, 0, Math.PI));
  kit.add(U, 'hull', T(hexPlate(0.75, 1.15, 0.55, 0.25, 0.07), s * 0.12, -0.85, -0.28, 0.06, s * 0.3));
  kit.add(U, 'panel', T(hexPlate(0.6, 0.9, 0.45, 0.2, 0.06), 0, -0.9, 0.35, -0.1));
  kit.add(U, 'steel', T(pistonGeo(1.1, 0.055), s * 0.3, -1.5, 0.18, 0.12));
  kit.add(U, 'dark', T(sleeveGeo(0.7, 0.09), s * 0.3, -1.55, 0.18, 0.12));
  // deltoid cap at the pivot
  kit.add(U, 'panel', T(latheGeo([[0.05, 0], [0.4, 0.06], [0.46, 0.3], [0.34, 0.5]], 12), 0, 0.15, 0, Math.PI));

  // ---- elbow actuator ----
  kit.add(F, 'steel', T(latheGeo([[0.24, -0.18], [0.3, 0], [0.24, 0.18]], 14), 0, 0.05, 0, 0, 0, Math.PI / 2));
  kit.add(F, 'dark', T(rbox(0.62, 0.35, 0.5, 0.08), 0, 0.05, 0.12));

  // ---- forearm variants ----
  if (armId === 'piledriver') {
    // massive ram: heavy octagonal housing, rear spike, 3 drive pistons
    kit.add(F, 'hull', T(latheGeo([[0.32, 0], [0.55, 0.2], [0.58, 1.5], [0.5, 1.9]], 8), 0, -2.15, 0, Math.PI));
    kit.add(F, 'dark', T(latheGeo([[0.2, 0], [0.3, 0.7]], 8), 0, 0.75, 0, 0));           // rear ram spike
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      kit.add(F, 'steel', T(pistonGeo(1.1, 0.05), Math.cos(a) * 0.42, -1.15, Math.sin(a) * 0.42));
    }
    kit.add(F, 'emissive', T(ventGeo(3, 0.4, 0.07, 0.1, 0.08), s * 0.5, -1.1, -0.28, 0, s * Math.PI / 2));
  } else if (armId === 'falchion') {
    // cutting blade: slim forearm + a long thermal fin blade on the outer edge
    kit.add(F, 'hull', T(latheGeo([[0.26, 0], [0.36, 0.3], [0.33, 1.6], [0.26, 2.0]], 10), 0, -2.2, 0, Math.PI));
    kit.add(F, 'panel', T(plateGeo([[0, -2.9], [0.34, -2.5], [0.4, -0.4], [0.12, 0.1], [-0.12, 0.1], [-0.12, -2.5]], 0.09, 0.03), s * 0.42, -0.5, 0, 0, s * Math.PI / 2));
    kit.add(F, 'emissive', T(rbox(0.05, 2.1, 0.05), s * 0.46, -1.6, 0));               // hot edge
  } else if (armId === 'howler') {
    // integral rotary cannon: tri-barrel cluster + ammo drum, no hand
    kit.add(F, 'hull', T(latheGeo([[0.3, 0], [0.5, 0.25], [0.52, 1.3], [0.42, 1.7]], 10), 0, -1.95, 0, Math.PI));
    kit.add(F, 'dark', T(latheGeo([[0.34, 0], [0.34, 0.5], [0.28, 0.55]], 12), 0, -2.5, 0, Math.PI)); // barrel shroud base
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.add(F, 'steel', T(latheGeo([[0.07, 0], [0.07, 1.0], [0.09, 1.02], [0.09, 1.1]], 8), Math.cos(a) * 0.17, -3.6, Math.sin(a) * 0.17, Math.PI));
    }
    kit.add(F, 'dark', T(latheGeo([[0.3, 0], [0.42, 0.08], [0.42, 0.55], [0.3, 0.62]], 12), s * 0.35, -1.5, 0.4, 0.35, 0, s * 0.4)); // ammo drum
    kit.add(F, 'emissive', T(rbox(0.3, 0.08, 0.08), 0, -2.4, -0.45));
  } else if (armId === 'bulwark') {
    // shield arm: forearm + full tower shield on the outer face
    kit.add(F, 'hull', T(latheGeo([[0.26, 0], [0.38, 0.3], [0.35, 1.7], [0.3, 2.0]], 10), 0, -2.2, 0, Math.PI));
    kit.add(F, 'hull', T(hexPlate(1.7, 3.4, 0.28, 0.55, 0.12), s * 0.75, -1.3, 0, 0, s * Math.PI / 2));
    kit.add(F, 'panel', T(hexPlate(1.25, 2.7, 0.2, 0.45, 0.08), s * 0.95, -1.3, 0, 0, s * Math.PI / 2));
    kit.add(F, 'emissive', T(hexPlate(0.5, 0.5, 0.1, 0.18), s * 1.1, -1.3, 0, 0, s * Math.PI / 2));
    kit.add(F, 'accent', T(rbox(0.06, 2.9, 0.16), s * 1.06, -1.3, -0.6));
  } else { // breaker (standard)
    kit.add(F, 'hull', T(latheGeo([[0.28, 0], [0.42, 0.3], [0.38, 1.5], [0.3, 1.9]], 10), 0, -2.1, 0, Math.PI));
    kit.add(F, 'panel', T(hexPlate(0.6, 1.3, 0.4, 0.22, 0.06), s * 0.28, -1.25, -0.2, 0, s * 0.4));
    kit.add(F, 'steel', T(pistonGeo(1.3, 0.05), s * -0.28, -1.5, 0.22, 0.1));
    kit.add(F, 'dark', T(sleeveGeo(0.8, 0.09), s * -0.28, -1.6, 0.22, 0.1));
  }

  // wrist collar (all arms except howler get a hand)
  if (armId !== 'howler') {
    kit.add(F, 'dark', T(latheGeo([[0.3, 0], [0.36, 0.06], [0.36, 0.2], [0.3, 0.26]], 12), 0, -2.28, 0));
    // ---- fist: knuckle block, four segmented fingers, opposed thumb ----
    kit.add(H, 'panel', T(rbox(0.78, 0.62, 0.72, 0.1), 0, -0.28, 0));
    kit.add(H, 'dark', T(rbox(0.82, 0.24, 0.5, 0.06), 0, -0.62, -0.14));       // knuckle bar
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.19;
      kit.add(H, 'hull', T(rbox(0.15, 0.34, 0.3, 0.04), fx, -0.78, -0.28, 0.5));
      kit.add(H, 'dark', T(rbox(0.13, 0.26, 0.22, 0.03), fx, -0.98, -0.12, 1.1));
    }
    kit.add(H, 'hull', T(rbox(0.18, 0.4, 0.24, 0.05), 0.32 * -s, -0.45, 0.4, -0.7, 0, s * 0.5)); // thumb
    if (armId === 'piledriver') {
      kit.add(H, 'dark', T(rbox(0.9, 0.3, 0.8, 0.05), 0, -0.05, 0));            // extra knuckle armour
      kit.add(H, 'emissive', T(rbox(0.5, 0.08, 0.08), 0, -0.66, -0.4));
    }
  }
  return { upperLen, foreLen };
}

// legs: hip node (pivot at hip), shin node (pivot at knee), foot node (ankle)
function buildLeg(kit, P, side, legsId) {
  const s = side === 'L' ? -1 : 1;
  const HN = 'hip' + side, SN = 'shin' + side, FN = 'foot' + side;
  const thighLen = 2.2, shinLen = 1.95;
  const beef = legsId === 'colossus' ? 1.22 : legsId === 'vector' ? 0.9 : 1.0;

  // hip actuator ball + thigh
  kit.add(HN, 'steel', T(latheGeo([[0.3, -0.25], [0.42, 0], [0.3, 0.25]], 14), 0, 0, 0, 0, 0, Math.PI / 2));
  kit.add(HN, 'dark', T(latheGeo([[0.34 * beef, 0], [0.5 * beef, 0.3], [0.46 * beef, 1.4], [0.38 * beef, 1.9]], 12), 0, -2.1, 0, Math.PI));
  kit.add(HN, 'hull', T(hexPlate(0.95 * beef, 1.5, 0.5, 0.3, 0.08), s * 0.12, -1.0, -0.4, 0.1));        // front thigh plate
  kit.add(HN, 'panel', T(hexPlate(0.7 * beef, 1.3, 0.4, 0.25, 0.07), s * 0.5 * beef, -1.1, 0, 0.05, s * Math.PI / 2)); // outer thigh plate
  kit.add(HN, 'steel', T(pistonGeo(0.95, 0.055), s * 0.18, -1.75, 0.3, 0.14));
  kit.add(HN, 'dark', T(sleeveGeo(0.6, 0.09), s * 0.18, -1.8, 0.3, 0.14));

  // knee: exposed actuator + guard plate
  kit.add(SN, 'steel', T(latheGeo([[0.26, -0.2], [0.34, 0], [0.26, 0.2]], 14), 0, 0, 0, 0, 0, Math.PI / 2));
  kit.add(SN, 'hull', T(wedgePlate(0.75 * beef, 0.85, 0.4, 0.55, 0.08), 0, -0.15, -0.5, 0.25));
  // shin: tapered greave with calf mass
  kit.add(SN, 'dark', T(latheGeo([[0.3 * beef, 0], [0.42 * beef, 0.3], [0.34 * beef, 1.3], [0.3 * beef, 1.7]], 12), 0, -1.9, 0, Math.PI));
  kit.add(SN, 'hull', T(wedgePlate(0.72 * beef, 1.5, 0.4, 0.7, 0.08), 0, -1.1, -0.42, 0.05));
  kit.add(SN, 'panel', T(hexPlate(0.55 * beef, 1.1, 0.4, 0.2, 0.06), 0, -1.0, 0.4, -0.12)); // calf plate
  kit.add(SN, 'steel', T(pistonGeo(0.85, 0.045), s * 0.2, -1.45, 0.24, 0.12));

  // foot: sculpted, splayed, with toe + heel — plantigrade stance
  kit.add(FN, 'dark', T(rbox(0.95 * beef, 0.34, 1.5, 0.09), 0, -0.28, -0.1));
  kit.add(FN, 'hull', T(wedgePlate(0.95 * beef, 0.6, 0.55, 0.55, 0.07), 0, -0.18, -0.78, 1.2));  // toe cap
  kit.add(FN, 'panel', T(rbox(0.7 * beef, 0.4, 0.5, 0.08), 0, -0.2, 0.65));                       // heel
  kit.add(FN, 'dark', T(latheGeo([[0.2, 0], [0.28, 0.1], [0.28, 0.3]], 10), 0, 0.02, 0));         // ankle collar

  if (legsId === 'colossus') {
    kit.add(SN, 'hull', T(wedgePlate(0.9, 0.7, 0.5, 0.6, 0.1), 0, -0.55, -0.55, 0.4));           // double knee slab
    kit.add(FN, 'dark', T(rbox(1.25, 0.24, 1.8, 0.08), 0, -0.36, -0.1));                          // wide stomper sole
    kit.add(HN, 'steel', T(pistonGeo(0.95, 0.055), s * -0.22, -1.75, 0.3, 0.14));                 // extra hydraulics
  } else if (legsId === 'vector') {
    // thruster calves: twin bells + emissive nozzles
    for (const dz of [0.12, 0.42]) {
      kit.add(SN, 'dark', T(latheGeo([[0.06, 0], [0.16, 0.12], [0.2, 0.34], [0.15, 0.4]], 12), s * 0.28, -1.5, 0.55 + dz * 0.4, Math.PI + 0.5));
      kit.add(SN, 'emissive', T(latheGeo([[0.02, 0], [0.12, 0.06]], 10), s * 0.28, -1.68, 0.62 + dz * 0.4, Math.PI + 0.5));
    }
    kit.add(HN, 'accent', T(rbox(0.07, 1.2, 0.3, 0.03), s * (0.55 * beef + 0.1), -1.1, 0));
  } else if (legsId === 'anchor') {
    // outrigger toes: extra side claws for an unshakeable stance
    for (const sx of [-1, 1]) kit.add(FN, 'dark', T(wedgePlate(0.35, 0.5, 0.4, 0.5, 0.05), sx * 0.55 * beef, -0.25, -0.5, 1.3, sx * 0.5));
    kit.add(FN, 'emissive', T(rbox(0.35, 0.07, 0.07), 0, -0.05, 0.85));
  }
  return { thighLen, shinLen };
}

// shoulder hardpoint modules — mounted on a socket node above each pauldron
function buildShoulderMount(kit, node, side, mountId, opts = {}) {
  const s = side === 'L' ? -1 : 1;
  if (mountId === 'empty' || !mountId) {
    kit.add(node, 'dark', T(rbox(0.5, 0.12, 0.5, 0.04), 0, 0, 0)); // bare socket plate
    return;
  }
  if (mountId === 'hydra' || mountId === 'pods') {
    // rocket pod: angled box launcher with a grid of tube openings
    const tubes = opts.tubes || 6;
    kit.add(node, 'hull', T(rbox(1.15, 0.75, 1.35, 0.1), 0, 0.42, 0, -0.16));
    kit.add(node, 'dark', T(rbox(1.0, 0.6, 0.24, 0.05), 0, 0.5, -0.68, -0.16));
    const cols = 3, rows = Math.ceil(tubes / cols);
    for (let i = 0; i < tubes; i++) {
      const cx = ((i % cols) - 1) * 0.3, cy = 0.34 + Math.floor(i / cols) * -0.28;
      kit.add(node, 'emissive', T(latheGeo([[0.02, 0], [0.1, 0.03], [0.1, 0.1]], 8), cx, 0.52 + cy - 0.34, -0.78 - (0.52 + cy - 0.34) * -0.16, Math.PI / 2 - 0.16));
    }
    kit.add(node, 'steel', T(pistonGeo(0.4, 0.05), s * 0.35, 0.05, 0.3, 0.9));
  } else if (mountId === 'sentry' || mountId === 'turret') {
    // auto turret: yaw drum + twin barrels (render.js animates node yaw)
    kit.add(node, 'dark', T(latheGeo([[0.3, 0], [0.36, 0.1], [0.32, 0.3]], 12), 0, 0.1, 0));
    kit.add(node, 'panel', T(rbox(0.55, 0.35, 0.75, 0.07), 0, 0.45, 0));
    for (const bx of [-0.12, 0.12]) {
      kit.add(node, 'steel', T(latheGeo([[0.045, 0], [0.045, 0.8], [0.06, 0.82], [0.06, 0.9]], 8), bx, 0.45, -0.35, Math.PI / 2));
    }
    kit.add(node, 'glow', T(rbox(0.1, 0.08, 0.08), 0, 0.62, -0.3));
  } else if (mountId === 'projector') {
    // aegis projector: tri-vane emitter dish
    kit.add(node, 'dark', T(latheGeo([[0.08, 0], [0.22, 0.15], [0.12, 0.4]], 10), 0, 0.15, 0));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.add(node, 'panel', T(wedgePlate(0.3, 0.65, 0.08, 0.4, 0.03), Math.cos(a) * 0.3, 0.62, Math.sin(a) * 0.3, 0.3, -a));
    }
    kit.add(node, 'emissive', T(latheGeo([[0.02, 0], [0.16, 0.04], [0.18, 0.1]], 12), 0, 0.5, 0));
  } else if (mountId === 'forge') {
    // repair rig: folded crane arm with welding tips
    kit.add(node, 'dark', T(rbox(0.4, 0.5, 0.4, 0.07), 0, 0.25, 0));
    kit.add(node, 'panel', T(rbox(0.16, 0.95, 0.16, 0.04), s * 0.1, 0.85, 0.1, 0, 0, s * 0.5));
    kit.add(node, 'panel', T(rbox(0.13, 0.8, 0.13, 0.04), s * 0.45, 1.3, 0.1, 0, 0, s * 1.6));
    kit.add(node, 'emissive', T(latheGeo([[0.015, 0], [0.05, 0.12]], 8), s * 0.83, 1.32, 0.1, 0, 0, s * 1.6));
    kit.add(node, 'steel', T(pistonGeo(0.5, 0.035), s * 0.16, 0.6, 0.14, 0, 0, s * 1.0));
  }
}

// ===========================================================================
// visible RUN-UPGRADE attachments (rebuilt whenever `up` changes)
// ===========================================================================
function buildUpgrades(kit, P, up, build) {
  const armorT = up.armor || 0;
  // ARMOR: progressive applique plates, thicker each tier
  if (armorT >= 1) kit.add('chest', 'hull', T(hexPlate(1.7 * P.w, 1.1, 0.34 + armorT * 0.05, 0.4, 0.1), 0, 0.95, -1.55, 0.1));
  if (armorT >= 2) for (const s of [-1, 1]) kit.add('sock' + (s < 0 ? 'L' : 'R'), 'hull', T(wedgePlate(1.0, 0.6, 0.4, 0.6, 0.08), s * 0.1, -0.05, -0.62, -0.5));
  if (armorT >= 3) for (const S of ['L', 'R']) kit.add('foreArm' + S, 'hull', T(hexPlate(0.6, 1.15, 0.3, 0.25, 0.07), (S === 'L' ? -1 : 1) * 0.45, -1.2, -0.15, 0, (S === 'L' ? -1 : 1) * Math.PI / 2));
  if (armorT >= 4) for (const S of ['L', 'R']) kit.add('hip' + S, 'hull', T(hexPlate(0.8, 1.2, 0.3, 0.3, 0.08), (S === 'L' ? -1 : 1) * 0.2, -1.15, -0.55, 0.1));
  if (armorT >= 5) for (const S of ['L', 'R']) kit.add('shin' + S, 'hull', T(wedgePlate(0.6, 1.2, 0.28, 0.7, 0.07), 0, -1.05, -0.62, 0.08));

  // FIST SERVOS: reinforcement rings + energy conduits, hotter per tier
  const dmgT = up.dmg || 0;
  if (dmgT >= 1) {
    for (const S of ['L', 'R']) {
      if (build['arm' + S] === 'howler') continue;
      kit.add('fist' + S, 'accent', T(latheGeo([[0.5, 0], [0.55, 0.06], [0.55, 0.16], [0.5, 0.2]], 10), 0, -0.05, 0));
      if (dmgT >= 2) kit.add('fist' + S, 'emissive', T(rbox(0.6, 0.09, 0.09), 0, -0.66, -0.36));
      if (dmgT >= 3) kit.add('foreArm' + S, 'emissive', T(rbox(0.06, 1.4, 0.06), (S === 'L' ? -1 : 1) * 0.34, -1.3, -0.28));
    }
  }

  // ACTUATOR OVERDRIVE: calf boosters + hip nozzles
  const spdT = up.speed || 0;
  if (spdT >= 1) for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    kit.add('shin' + S, 'steel', T(pistonGeo(0.85, 0.045), s * -0.2, -1.45, 0.24, 0.12));
    if (spdT >= 2) {
      kit.add('shin' + S, 'dark', T(latheGeo([[0.05, 0], [0.14, 0.1], [0.17, 0.3], [0.13, 0.36]], 10), s * 0.3, -1.75, 0.5, Math.PI + 0.4));
      kit.add('shin' + S, 'emissive', T(latheGeo([[0.02, 0], [0.1, 0.05]], 8), s * 0.3, -1.9, 0.56, Math.PI + 0.4));
    }
  }

  // CAPACITOR BANKS: head emitter conduits + cooling fins
  const lasT = up.laser || 0;
  if (lasT >= 1) {
    kit.add('head', 'emissive', T(rbox(0.06, 0.4, 0.06), 0.2, 0.45, 0.25, 0.3));
    kit.add('head', 'emissive', T(rbox(0.06, 0.4, 0.06), -0.2, 0.45, 0.25, 0.3));
    if (lasT >= 2) kit.add('head', 'dark', T(ventGeo(3, 0.5, 0.06, 0.3, 0.06), 0, 0.65, 0.3, 0.6));
    if (lasT >= 3) kit.add('chest', 'emissive', T(rbox(0.08, 1.2, 0.08), 0, 2.0, 1.1, 0.5));
  }

  // ROCKET FIST: forearm booster nozzles
  if (up.rocket) for (const S of ['L', 'R']) {
    if (build['arm' + S] === 'howler') continue;
    const s = S === 'L' ? -1 : 1;
    kit.add('foreArm' + S, 'dark', T(latheGeo([[0.05, 0], [0.13, 0.1], [0.15, 0.26]], 10), s * 0.4, -0.7, 0.3, Math.PI - 0.4));
    kit.add('foreArm' + S, 'emissive', T(latheGeo([[0.02, 0], [0.09, 0.05]], 8), s * 0.4, -0.56, 0.36, Math.PI - 0.4));
  }

  // SHOULDER TURRET / ROCKET PODS bought mid-run land on free sockets
  // (or stack onto the backpack if the hangar already filled both).
  if (up.turret && build.shoulderL !== 'sentry' && build.shoulderR !== 'sentry') {
    const free = build.shoulderR === 'empty' ? 'sockR' : build.shoulderL === 'empty' ? 'sockL' : 'back';
    buildShoulderMount(kit, free === 'back' ? 'chest' : free, free === 'sockL' ? 'L' : 'R', 'sentry');
  }
  if (up.pods && build.shoulderL !== 'hydra' && build.shoulderR !== 'hydra') {
    const free = build.shoulderL === 'empty' ? 'sockL' : build.shoulderR === 'empty' ? 'sockR' : 'back';
    buildShoulderMount(kit, free === 'back' ? 'chest' : free, free === 'sockR' ? 'R' : 'L', 'hydra');
  }

  // ROTARY CANNON bought mid-run: underslung tri-barrel on the right forearm
  if (up.cannon && build.armR !== 'howler') {
    kit.add('foreArmR', 'dark', T(rbox(0.3, 0.4, 1.3, 0.06), 0.42, -1.7, -0.2));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.add('foreArmR', 'steel', T(latheGeo([[0.04, 0], [0.04, 0.9]], 8), 0.42 + Math.cos(a) * 0.09, -2.55, -0.2 + Math.sin(a) * 0.09, Math.PI));
    }
  }

  // DASH THRUSTERS: backpack booster pack
  if (up.dash && build.legs !== 'vector') {
    for (const s of [-1, 1]) {
      kit.add('chest', 'dark', T(latheGeo([[0.1, 0], [0.24, 0.15], [0.28, 0.6], [0.2, 0.7]], 12), s * 0.55, 0.3, 1.85, Math.PI));
      kit.add('chest', 'emissive', T(latheGeo([[0.02, 0], [0.16, 0.08]], 10), s * 0.55, 0.02, 1.85, Math.PI));
    }
  }
}

// ===========================================================================
// THE FACTORY
// ===========================================================================
export function buildMech({ build, up = {}, mats = null, paint = null }) {
  const P = FRAME_P[build.frame] || FRAME_P.warden;
  const M = mats || mechMaterials(paint || build.paint);

  const root = new THREE.Group();
  const nodes = { root };
  const mk = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    nodes[name] = g;
    return g;
  };

  // articulation skeleton (local origin = torso center, -Z forward)
  const chest = mk('chest', root, 0, 0, 0);
  mk('head', chest, 0, 3.05, -0.15);
  const pelvis = mk('pelvis', root, 0, -2.15, 0.05);
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? -1 : 1;
    const sh = mk('shoulder' + S, chest, s * 2.6 * P.w, 2.05, 0.1);
    mk('sock' + S, sh, s * 0.15, 1.05 * P.pauldron, 0.15);          // hardpoint socket
    const ua = mk('upperArm' + S, sh, s * 0.55, -0.25, 0);
    const fa = mk('foreArm' + S, ua, 0, -2.05, 0);
    mk('fist' + S, fa, 0, -2.3, 0);
    const hip = mk('hip' + S, pelvis, s * 1.15 * P.w, -0.45, 0);
    const shin = mk('shin' + S, hip, 0, -2.2, 0);
    mk('foot' + S, shin, 0, -1.95, 0.05);
  }

  const kit = new Kit();
  buildTorso(kit, P, build.torso);
  buildHead(kit, P, build.head);
  for (const S of ['L', 'R']) {
    buildPauldron(kit, P, 'shoulder' + S, S, build.frame);
    buildArm(kit, P, S, build['arm' + S]);
    buildLeg(kit, P, S, build.legs);
    buildShoulderMount(kit, 'sock' + S, S, build['shoulder' + S]);
  }
  if (build.armorKit === 'skirmish') {
    kit.add('chest', 'panel', T(hexPlate(1.9 * P.w, 0.9, 0.3, 0.35, 0.08), 0, 0.55, -1.5, -0.1));
    for (const S of ['L', 'R']) kit.add('shin' + S, 'panel', T(wedgePlate(0.55, 1.0, 0.22, 0.7, 0.06), 0, -1.0, -0.58, 0.06));
  } else if (build.armorKit === 'siege') {
    kit.add('chest', 'hull', T(hexPlate(2.3 * P.w, 1.4, 0.5, 0.5, 0.12), 0, 1.1, -1.6, 0.12));
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? -1 : 1;
      kit.add('shoulder' + S, 'hull', T(hexPlate(1.1, 1.3, 0.4, 0.35, 0.1), s * 1.0 * P.pauldron, 0.2, 0, 0, s * Math.PI / 2, s * -0.2));
      kit.add('foreArm' + S, 'panel', T(hexPlate(0.55, 1.0, 0.26, 0.22, 0.06), s * 0.42, -1.2, -0.1, 0, s * Math.PI / 2));
      kit.add('hip' + S, 'panel', T(hexPlate(0.7, 1.05, 0.26, 0.28, 0.07), s * 0.15, -1.1, -0.5, 0.08));
    }
  }
  const staticMeshes = kit.bake(nodes, M);

  // the EYE: separate mesh (charge glow animates it)
  const eye = new THREE.Mesh(hexPlate(0.85, 0.22, 0.14, 0.08, 0.03), new THREE.MeshBasicMaterial({ color: paintOf(build).emissive }));
  eye.position.set(0, 0.1, -0.56);
  nodes.head.add(eye);
  nodes.eye = eye;

  // decal planes (chest + left pauldron)
  let decals = [];
  if (build.decal && build.decal !== 'none') {
    const tex = decalTexture(build.decal, paintOf(build).accent);
    const dm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
    const d1 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), dm);
    d1.position.set(-1.1 * P.w, 1.5, -1.52); d1.rotation.x = -0.14; d1.rotation.y = -0.24;
    nodes.chest.add(d1);
    const d2 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), dm);
    d2.position.set((build.frame === 'bastion' ? -1.38 : -1.15), 0.25, 0); d2.rotation.y = -Math.PI / 2;
    nodes.shoulderL.add(d2);
    decals = [d1, d2];
  }

  // upgrade attachments live in their own bucket so they can be swapped
  let upgradeMeshes = [];
  const setUpgrades = (newUp) => {
    for (const m of upgradeMeshes) { m.parent?.remove(m); m.geometry.dispose(); }
    const ukit = new Kit();
    buildUpgrades(ukit, P, newUp || {}, build);
    upgradeMeshes = ukit.bake(nodes, M);
  };
  setUpgrades(up);

  root.userData.bones = { upperLen: 2.05, foreLen: 2.3, thighLen: 2.2, shinLen: 1.95 };

  return {
    root, nodes, mats: M,
    setUpgrades,
    dispose() {
      for (const m of [...staticMeshes, ...upgradeMeshes]) m.geometry.dispose();
      for (const d of decals) { d.geometry.dispose(); d.material.map?.dispose(); d.material.dispose(); }
      eye.geometry.dispose(); eye.material.dispose();
    },
  };
}

function paintOf(build) {
  return build.paint || { primary: '#5f6c7d', secondary: '#39434f', accent: '#d8a03c', emissive: '#3fd6ff' };
}
