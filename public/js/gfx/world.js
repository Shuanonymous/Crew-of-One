import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  hashStr, mulberry32, worldUVBox,
} from './util.js';
import {
  facadeSet, asphaltSet, concreteSet, steelSet, flareSprite,
} from './materials.js';

// City construction. All static geometry is merged into a handful of draw
// calls; every material is a full PBR set so the night lighting (cool key,
// sodium pools, lit windows, wet reflections) has something real to bite.

// desaturated architectural tints — applied over the neutral facade sheets
function facadeTint(hex) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(0.18, hsl.s * 0.5), 0.52 + (hsl.l - 0.3) * 0.3);
  return c;
}

export function buildWorld(R, world) {
  R.clearWorld();
  const g = R.worldGroup;
  R.bldgDefs = [];
  R.bldgDown = new Set();
  R.bldgDeco = new Map();
  R.bldgBatchMeshes = [];
  R.bldgMats = R.bldgMats || new Map();
  R.pulsers = [];          // aviation beacons etc — pulsed in stepAtmosphere
  R.waterMats = [];        // scrolling normal maps

  for (const d of world.city) {
    if (d.kind === 'ground') {
      const set = asphaltSet();
      if (!R._asphaltReady) {
        for (const t of [set.map, set.normalMap, set.roughnessMap]) t.repeat.set(30, 30);
        R._asphaltReady = true;
      }
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...d.size),
        new THREE.MeshStandardMaterial({
          color: '#6a7284', map: set.map,
          metalness: 0.32, roughness: 1.0, roughnessMap: set.roughnessMap,
          normalMap: set.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
          envMapIntensity: 1.5,
        })
      );
      mesh.position.set(...d.p);
      mesh.receiveShadow = true;
      g.add(mesh);
    } else if (d.kind === 'disc') {
      const set = concreteSet();
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(d.size[0], 48),
        new THREE.MeshStandardMaterial({
          color: '#8b8f98', map: set.map, normalMap: set.normalMap,
          metalness: 0.05, roughness: 0.85,
        })
      );
      mesh.material.map.repeat.set(6, 6);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(...d.p);
      mesh.receiveShadow = true;
      g.add(mesh);
    } else if (d.kind === 'river') {
      // black water: glassy standard material with a slowly-scrolling
      // normal map — catches the sky glow and the neon
      const set = asphaltSet();
      const norm = set.normalMap.clone();
      norm.needsUpdate = true;
      norm.repeat.set(3, 26);
      const mat = new THREE.MeshStandardMaterial({
        color: '#060a12', metalness: 0.85, roughness: 0.12,
        normalMap: norm, normalScale: new THREE.Vector2(0.25, 0.25),
        envMapIntensity: 1.8,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.size[0], d.size[1]), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(d.p[0], d.p[1], d.p[2]);
      g.add(mesh);
      R.waterMats.push(mat);
    } else if (d.kind === 'landmark') {
      buildLandmark(R, g, d);
    } else if (d.kind === 'building') {
      R.bldgDefs.push(d);
      decorateBuilding(R, g, d);
    } else if (d.kind === 'lamp') {
      (R._lampDefs = R._lampDefs || []).push(d);
    } else if (d.kind === 'billboard') {
      addBillboard(R, g, d);
    }
  }
  rebuildBuildingBatches(R);
  buildStreetFurniture(R, g);
  buildDamage(R, g, world);

  // endless-run interactables
  R.beaconViews = []; // endless buys anywhere — kept (and empty) for the E2E constraint
  R.tankViews = [];
  const steel = steelSet();
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#8d9099', map: steel.map, roughnessMap: steel.roughnessMap,
    metalness: 0.85, roughness: 1.0, envMapIntensity: 1.2,
  });
  for (const t of world.tanks || []) {
    // industrial fuel tank: ribbed pressure vessel with hazard band
    const grp = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({
      color: '#d9793a', map: steel.map, roughnessMap: steel.roughnessMap,
      metalness: 0.55, roughness: 1.0, envMapIntensity: 1.0,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.8, 20), shell);
    body.position.y = 2.1; body.castShadow = true;
    grp.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    dome.position.y = 4.0;
    grp.add(dome);
    for (const ry of [1.1, 3.1]) {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(2.12, 2.12, 0.22, 20), steelMat);
      rib.position.y = ry;
      grp.add(rib);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.06, 2.06, 0.5, 20),
      new THREE.MeshStandardMaterial({ color: '#1a1206', emissive: new THREE.Color('#ff8a1e'), emissiveIntensity: 1.1, roughness: 0.5 }));
    band.position.y = 2.1;
    grp.add(band);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 8), steelMat);
    pipe.position.set(1.4, 4.6, 0); pipe.rotation.z = 0.5;
    grp.add(pipe);
    const valve = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 6, 12), steelMat);
    valve.position.set(0, 4.9, 0); valve.rotation.x = Math.PI / 2;
    grp.add(valve);
    grp.position.set(t.p[0], 0, t.p[2]);
    g.add(grp);
    R.tankViews.push(grp);
  }
  R.stationViews = [];
  for (const s of world.stations || []) {
    // field repair bay: deck plate, perimeter pylons, spinning holo cross
    const grp = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.5, 24), steelMat);
    pad.position.y = 0.25;
    pad.receiveShadow = true;
    grp.add(pad);
    const glow = new THREE.Mesh(new THREE.RingGeometry(7.5, 8.6, 36),
      new THREE.MeshBasicMaterial({ color: '#54e88f', transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.6;
    grp.add(glow);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const py = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4.2, 8), steelMat);
      py.position.set(Math.cos(a) * 8.2, 2.1, Math.sin(a) * 8.2);
      py.castShadow = true;
      grp.add(py);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#0a2014', emissive: new THREE.Color('#54e88f'), emissiveIntensity: 2.6 }));
      tip.position.set(Math.cos(a) * 8.2, 4.4, Math.sin(a) * 8.2);
      grp.add(tip);
    }
    const holo = new THREE.Group();
    const hm = new THREE.MeshBasicMaterial({ color: '#54e88f', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    holo.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.3), hm));
    holo.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 3.2, 0.3), hm));
    holo.position.y = 7;
    grp.add(holo);
    grp.userData.holo = holo;
    grp.position.set(s.p[0], 0, s.p[2]);
    g.add(grp);
    R.stationViews.push(grp);
  }
  R.cacheViews = [];
  for (const c of world.caches || []) {
    // armored supply crate: frame edges, glowing seam, stenciled lid
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(3, 3, 3, 2, 0.22),
      new THREE.MeshStandardMaterial({
        color: '#7a6a2c', map: steel.map, roughnessMap: steel.roughnessMap,
        metalness: 0.5, roughness: 1.0,
      }));
    body.castShadow = true;
    grp.add(body);
    for (const [rx, rz] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 0.4), steelMat);
      edge.rotation.set(rx, 0, rz);
      grp.add(edge);
    }
    const seam = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.18, 3.06),
      new THREE.MeshStandardMaterial({ color: '#241c06', emissive: new THREE.Color('#ffd166'), emissiveIntensity: 2.2 }));
    seam.position.y = 0.6;
    grp.add(seam);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 2.2), steelMat);
    lid.position.y = 1.55;
    grp.add(lid);
    grp.position.set(c.p[0], 1.5, c.p[2]);
    grp.rotation.y = 0.5;
    g.add(grp);
    R.cacheViews.push(grp);
  }
  R.pickupMeshes = new Map();

  // training props
  if (world.rings) {
    for (const r of world.rings) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(6, 0.65, 12, 40),
        new THREE.MeshStandardMaterial({ color: '#3d3413', emissive: new THREE.Color('#f5d76e'), emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.3 })
      );
      ring.position.set(r.p[0], 7, r.p[2]);
      g.add(ring);
      R.ringViews.push(ring);
    }
  }
  if (world.balloon) {
    const b = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(world.balloon.radius, 2),
      new THREE.MeshStandardMaterial({ color: '#c2403f', roughness: 0.35, metalness: 0.05, envMapIntensity: 1.2 })
    );
    b.add(ball);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 6),
      new THREE.MeshStandardMaterial({ color: '#8f2b25', roughness: 0.5 }));
    knot.position.y = -world.balloon.radius - 0.4;
    knot.rotation.x = Math.PI;
    b.add(knot);
    b.position.set(...world.balloon.p);
    g.add(b);
    R.balloonView = b;
  }
  if (world.crateSize) {
    const set = concreteSet();
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(world.crateSize, world.crateSize, world.crateSize),
        new THREE.MeshStandardMaterial({
          color: ['#b08d3f', '#a35b3c', '#3f7a6e', '#7a5b8f'][i],
          map: set.map, roughness: 0.8, metalness: 0.05,
        })
      );
      c.castShadow = c.receiveShadow = true;
      g.add(c);
      R.crateMeshes.push(c);
    }
  }

  // dynamic props (puntable cars): clearcoat paint, glass cabin, wheels
  R.propMeshes.clear();
  for (const d of world.props || []) {
    const car = new THREE.Group();
    const [w, h, dp] = d.size;
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(w, h * 0.55, dp, 3, 0.18),
      new THREE.MeshPhysicalMaterial({
        color: d.color, metalness: 0.9, roughness: 0.35,
        clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.4,
      })
    );
    body.position.y = 0.1;
    body.castShadow = true;
    car.add(body);
    const cabin = new THREE.Mesh(
      new RoundedBoxGeometry(w * 0.5, h * 0.45, dp * 0.82, 2, 0.14),
      new THREE.MeshStandardMaterial({ color: '#0a141e', metalness: 0.2, roughness: 0.05, envMapIntensity: 2.0 })
    );
    cabin.position.set(-w * 0.06, h * 0.42, 0);
    car.add(cabin);
    const wheelG = new THREE.CylinderGeometry(h * 0.28, h * 0.28, 0.24, 12);
    const wheelM = new THREE.MeshStandardMaterial({ color: '#101116', metalness: 0.2, roughness: 0.9 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wh = new THREE.Mesh(wheelG, wheelM);
      wh.rotation.x = Math.PI / 2;
      wh.position.set(sx * w * 0.32, -h * 0.18, sz * (dp / 2 - 0.02));
      car.add(wh);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.4),
      new THREE.MeshStandardMaterial({ color: '#443f2a', emissive: new THREE.Color('#ffeebb'), emissiveIntensity: 2.4 }));
    head.position.set(w / 2 - 0.02, 0.12, 0);
    head.scale.z = dp * 1.4;
    car.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.36),
      new THREE.MeshStandardMaterial({ color: '#330a0a', emissive: new THREE.Color('#ff3333'), emissiveIntensity: 2.0 }));
    tail.position.set(-w / 2 + 0.02, 0.12, 0);
    tail.scale.z = dp * 1.4;
    car.add(tail);
    g.add(car);
    R.propMeshes.set(d.id, car);
  }
}

// tiered corporate tower with a lit crown and pulsing aviation beacon
function buildLandmark(R, g, d) {
  const [lw, lh, ld] = d.size;
  const variant = hashStr('lm' + d.p[0] + d.p[2]) % 3;
  const set = facadeSet(variant);
  const mat = new THREE.MeshStandardMaterial({
    color: facadeTint(d.color || '#2c3247'), map: set.map,
    emissive: new THREE.Color('#ffffff'), emissiveMap: set.emissiveMap, emissiveIntensity: 1.6,
    normalMap: set.normalMap, normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: set.roughnessMap, roughness: 1.0, metalness: 0.12,
  });
  const trim = new THREE.MeshStandardMaterial({ color: '#33394a', metalness: 0.7, roughness: 0.4 });
  const baseY = d.p[1] - lh / 2;
  const tiers = [[1.0, 0.58], [0.78, 0.26], [0.55, 0.13]];
  let ty = baseY;
  for (const [scale, frac] of tiers) {
    const th = lh * frac;
    const tier = new THREE.Mesh(
      worldUVBox(new THREE.BoxGeometry(lw * scale, th, ld * scale), lw * scale, th, ld * scale), mat);
    tier.position.set(d.p[0], ty + th / 2, d.p[2]);
    tier.castShadow = true;
    g.add(tier);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(lw * scale + 0.8, 0.7, ld * scale + 0.8), trim);
    ledge.position.set(d.p[0], ty + th, d.p[2]);
    g.add(ledge);
    ty += th;
  }
  // crown light band — the skyline signature
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(lw * 0.55 + 0.3, 1.2, ld * 0.55 + 0.3),
    new THREE.MeshStandardMaterial({ color: '#101820', emissive: new THREE.Color('#9fc6ff'), emissiveIntensity: 1.8 }));
  crown.position.set(d.p[0], ty - 0.8, d.p[2]);
  g.add(crown);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, lh * 0.14, 8), trim);
  mast.position.set(d.p[0], ty + lh * 0.07, d.p[2]);
  g.add(mast);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#300406', emissive: new THREE.Color('#ff2233'), emissiveIntensity: 3 }));
  cap.position.set(d.p[0], ty + lh * 0.14 + 1, d.p[2]);
  g.add(cap);
  R.pulsers.push(cap);
}

// Re-merge standing buildings into a few draw calls, keyed color+variant.
export function rebuildBuildingBatches(R) {
  const g = R.worldGroup;
  for (const m of R.bldgBatchMeshes) { g.remove(m); m.geometry.dispose(); }
  R.bldgBatchMeshes = [];
  const body = {}, roof = {};
  for (const d of R.bldgDefs) {
    if (R.bldgDown.has(d.id)) continue;
    const variant = hashStr('v' + (d.id ?? (d.p[0] + '_' + d.p[2]))) % 3;
    const box = worldUVBox(new THREE.BoxGeometry(...d.size), ...d.size);
    if (d.yaw) box.rotateY(d.yaw);
    box.translate(...d.p);
    const key = d.color + '|' + variant;
    (body[key] = body[key] || []).push(box);
    const rf = new THREE.BoxGeometry(d.size[0] + 0.7, 0.8, d.size[2] + 0.7);
    if (d.yaw) rf.rotateY(d.yaw);
    rf.translate(d.p[0], d.p[1] + d.size[1] / 2 + 0.4, d.p[2]);
    (roof[d.color] = roof[d.color] || []).push(rf);
  }
  const matFor = (key, make) => {
    if (!R.bldgMats.has(key)) R.bldgMats.set(key, make());
    return R.bldgMats.get(key);
  };
  for (const [key, geos] of Object.entries(body)) {
    const [color, variant] = key.split('|');
    const mesh = new THREE.Mesh(mergeGeometries(geos),
      matFor('b' + key, () => {
        const set = facadeSet(+variant);
        return new THREE.MeshStandardMaterial({
          color: facadeTint(color), map: set.map,
          emissive: new THREE.Color('#ffffff'), emissiveMap: set.emissiveMap, emissiveIntensity: 1.5,
          normalMap: set.normalMap, normalScale: new THREE.Vector2(0.85, 0.85),
          roughnessMap: set.roughnessMap, roughness: 1.0, metalness: 0.1,
        });
      }));
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    R.bldgBatchMeshes.push(mesh);
  }
  for (const [color, geos] of Object.entries(roof)) {
    const mesh = new THREE.Mesh(mergeGeometries(geos),
      matFor('r' + color, () => new THREE.MeshStandardMaterial({
        color: facadeTint(color).multiplyScalar(0.42),
        map: concreteSet().map, roughness: 0.9, metalness: 0.05,
      })));
    g.add(mesh);
    R.bldgBatchMeshes.push(mesh);
  }
}

// A building falls: pull it from the skyline, drop rubble, throw dust.
export function collapseBuilding(R, id, vfx = true) {
  if (!R.bldgDown || R.bldgDown.has(id)) return;
  const d = R.bldgDefs.find((x) => x.id === id);
  if (!d) return;
  R.bldgDown.add(id);
  rebuildBuildingBatches(R);
  const deco = R.bldgDeco.get(id);
  if (deco) R.worldGroup.remove(deco);

  const [w, h, dd] = d.size;
  const rng = mulberry32(hashStr('fall' + id));
  const chunks = [];
  const slab = (cw, ch, cd, x, y, z, ry, rz) => {
    const b = new THREE.BoxGeometry(cw, ch, cd);
    b.rotateY(ry); b.rotateZ(rz);
    b.translate(x, y, z);
    chunks.push(b);
  };
  slab(w * 0.6, 1.6 + h * 0.08, dd * 0.6, d.p[0], (1.6 + h * 0.08) / 2, d.p[2], rng() * 1, 0);
  const n = 5 + (hashStr(id) % 4);
  for (let i = 0; i < n; i++) {
    const cw = 1.5 + rng() * w * 0.4;
    const ch = 0.8 + rng() * 2.2;
    slab(cw, ch, cw * (0.5 + rng() * 0.8),
      d.p[0] + (rng() - 0.5) * w * 0.9, ch / 2, d.p[2] + (rng() - 0.5) * dd * 0.9,
      rng() * Math.PI, (rng() - 0.5) * 0.5);
  }
  const set = concreteSet();
  const rubble = new THREE.Mesh(mergeGeometries(chunks),
    new THREE.MeshStandardMaterial({ color: '#55525c', map: set.map, normalMap: set.normalMap, roughness: 0.95, metalness: 0.04, flatShading: true }));
  rubble.castShadow = rubble.receiveShadow = true;
  R.worldGroup.add(rubble);

  if (vfx) {
    const p = [d.p[0], 1, d.p[2]];
    R.dust([d.p[0], 7, d.p[2]], 30);
    R.ring(p, '#8b8496', Math.max(w, dd) * 1.4, 0.9);
    for (let i = 0; i < 9; i++) {
      R.smoke([d.p[0] + (Math.random() - 0.5) * w, 2 + Math.random() * h * 0.45,
        d.p[2] + (Math.random() - 0.5) * dd], 2.2, '#77716b');
    }
    const nCh = Math.min(12, 6 + Math.round(h / 8));
    for (let i = 0; i < nCh; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 14;
      R.debrisChunk(
        [d.p[0] + (Math.random() - 0.5) * w * 0.7, 2 + Math.random() * h * 0.6, d.p[2] + (Math.random() - 0.5) * dd * 0.7],
        [Math.cos(a) * sp, 4 + Math.random() * 10, Math.sin(a) * sp],
        0.7 + Math.random() * 1.3);
    }
    R.shake(0.65);
  }
}

// Battle-damage the district: broken tops, rubble, debris fields.
function buildDamage(R, g, world) {
  const concrete = [];
  const emberChunks = [];
  const pushBox = (arr, w, h, dd, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const b = new THREE.BoxGeometry(w, h, dd);
    if (rx || ry || rz) { b.rotateX(rx); b.rotateY(ry); b.rotateZ(rz); }
    b.translate(x, y, z);
    arr.push(b);
  };
  const buildings = (world.city || []).filter((d) => d.kind === 'building');
  for (const d of buildings) {
    const h = hashStr('dmg' + d.p[0] + '_' + d.p[2]);
    const rng = mulberry32(h);
    const [w, bh, dp] = d.size;
    const topY = d.p[1] + bh / 2;
    if (h % 100 < 55) {
      const attached = [];
      const teeth = 3 + (h % 4);
      for (let i = 0; i < teeth; i++) {
        const tw = w * (0.18 + rng() * 0.22);
        const th = 1.5 + rng() * (bh * 0.14);
        const ex = (rng() - 0.5) * (w - tw);
        const ez = (rng() - 0.5) * (dp - tw);
        pushBox(attached, tw, th, tw, d.p[0] + ex, topY + th / 2 - 0.4, d.p[2] + ez, 0, rng() * 0.6, (rng() - 0.5) * 0.25);
        if (rng() < 0.5) pushBox(attached, 0.08, th * 1.5, 0.08, d.p[0] + ex, topY + th * 0.9, d.p[2] + ez, (rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4);
      }
      if (h % 3 === 0 && bh > 16) {
        const sy = d.p[1] + (rng() - 0.3) * bh * 0.4;
        pushBox(attached, w * 0.3, bh * 0.16, 1.2, d.p[0] + (rng() - 0.5) * w * 0.4, sy, d.p[2] + dp / 2, 0, 0, (rng() - 0.5) * 0.3);
      }
      if (attached.length) {
        const set = concreteSet();
        const m = new THREE.Mesh(mergeGeometries(attached),
          new THREE.MeshStandardMaterial({ color: '#524f58', map: set.map, metalness: 0.05, roughness: 0.95, flatShading: true }));
        m.castShadow = true;
        const deco = R.bldgDeco?.get(d.id);
        (deco || g).add(m);
      }
    }
    if (h % 100 < 62) {
      const chunks = 3 + (h % 5);
      for (let i = 0; i < chunks; i++) {
        const cw = 1.2 + rng() * 2.6;
        const ch = 0.8 + rng() * 1.8;
        const a = rng() * Math.PI * 2;
        const rad = (Math.max(w, dp) / 2) + 0.5 + rng() * 3;
        const rx = d.p[0] + Math.cos(a) * rad;
        const rz = d.p[2] + Math.sin(a) * rad;
        pushBox(concrete, cw, ch, cw * (0.7 + rng() * 0.6), rx, ch / 2, rz, (rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
        if (rng() < 0.25) pushBox(emberChunks, 0.5, 0.5, 0.5, rx, 0.3, rz);
      }
    }
  }
  const grng = mulberry32(90210);
  for (let i = 0; i < 60; i++) {
    const x = (grng() - 0.5) * 300;
    const z = (grng() - 0.5) * 300;
    if (Math.hypot(x, z) < 22) continue;
    const cw = 0.8 + grng() * 2.2;
    const ch = 0.5 + grng() * 1.2;
    pushBox(concrete, cw, ch, cw, x, ch / 2, z, (grng() - 0.5) * 0.4, grng() * Math.PI, (grng() - 0.5) * 0.4);
  }
  if (concrete.length) {
    const set = concreteSet();
    const m = new THREE.Mesh(mergeGeometries(concrete),
      new THREE.MeshStandardMaterial({ color: '#524f58', map: set.map, normalMap: set.normalMap, metalness: 0.05, roughness: 0.95, flatShading: true }));
    m.castShadow = m.receiveShadow = true; g.add(m);
  }
  if (emberChunks.length) {
    const m = new THREE.Mesh(mergeGeometries(emberChunks),
      new THREE.MeshStandardMaterial({ color: '#2a0f04', emissive: new THREE.Color('#ff5a1e'), emissiveIntensity: 1.4, roughness: 0.9 }));
    g.add(m);
    R.emberDebris = m;
  }
}

// Street furniture: sodium streetlights + pooled light decals + sidewalks.
function buildStreetFurniture(R, g) {
  const lamps = R._lampDefs || [];
  R._lampDefs = null;
  if (lamps.length) {
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
      new THREE.MeshStandardMaterial({ color: '#23262e', metalness: 0.8, roughness: 0.45 }));
    poleMesh.castShadow = true;
    g.add(poleMesh);
    const headMesh = new THREE.Mesh(mergeGeometries(heads),
      new THREE.MeshStandardMaterial({ color: '#332608', emissive: new THREE.Color('#ffca7a'), emissiveIntensity: 3.2 }));
    g.add(headMesh);
    // sodium pools: a soft additive disc of light on the wet street under
    // every lamp head — sells "night city" for one draw call
    const pool = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({
        map: flareSprite(), color: '#b97a2e', transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      lamps.length);
    const m4 = new THREE.Matrix4();
    lamps.forEach((d, i) => {
      m4.makeRotationX(-Math.PI / 2);
      m4.setPosition(d.p[0] + 2.2, 0.12, d.p[2]);
      pool.setMatrixAt(i, m4);
    });
    pool.instanceMatrix.needsUpdate = true;
    pool.renderOrder = 2;
    g.add(pool);
  }
  // sidewalk plinths: pale concrete aprons around building footprints
  const slabs = [];
  for (const d of R.bldgDefs) {
    const [w, , dd] = d.size;
    const s = new THREE.BoxGeometry(w + 3, 0.28, dd + 3);
    if (d.yaw) s.rotateY(d.yaw);
    s.translate(d.p[0], 0.14, d.p[2]);
    slabs.push(s);
  }
  if (slabs.length) {
    const set = concreteSet();
    const m = new THREE.Mesh(mergeGeometries(slabs),
      new THREE.MeshStandardMaterial({ color: '#6a6d75', map: set.map, normalMap: set.normalMap, metalness: 0.08, roughness: 0.9 }));
    m.receiveShadow = true;
    g.add(m);
  }
}

// rooftop garnish: water towers, AC units, antennas, neon strips
function decorateBuilding(R, parent, d) {
  const g = new THREE.Group();
  parent.add(g);
  if (d.id != null && R.bldgDeco) R.bldgDeco.set(d.id, g);
  const h = hashStr(d.p[0] + ',' + d.p[2]);
  const rng = mulberry32(h);
  const topY = d.p[1] + d.size[1] / 2;
  const steel = steelSet();
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#6f7278', map: steel.map, roughnessMap: steel.roughnessMap, metalness: 0.7, roughness: 1.0,
  });
  if (h % 5 === 0) {
    // rooftop water tower
    const tw = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 3, 12),
      new THREE.MeshStandardMaterial({ color: '#6b4b3a', map: steel.map, roughness: 0.85, metalness: 0.2 }));
    tank.position.y = 2.6;
    const lid = new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: '#503a2e', roughness: 0.9 }));
    lid.position.y = 4.7;
    tw.add(tank, lid);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4), steelMat);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 1.2, 1.2, Math.sin(a) * 1.2);
      tw.add(leg);
    }
    tw.position.set(d.p[0], topY, d.p[2]);
    g.add(tw);
  } else if (h % 5 === 1) {
    // AC plant: unit boxes + fan grilles
    for (let i = 0; i < 1 + (h % 3); i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.8 + rng() * 1.4, 1.1 + rng() * 0.6, 1.8 + rng()), steelMat);
      ac.position.set(d.p[0] + (rng() - 0.5) * d.size[0] * 0.5, topY + 0.6, d.p[2] + (rng() - 0.5) * d.size[2] * 0.5);
      ac.rotation.y = rng() * Math.PI;
      g.add(ac);
    }
  } else if (h % 5 === 2) {
    // antenna cluster
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 4 + rng() * 3), steelMat);
    const ah = ant.geometry.parameters.height;
    ant.position.set(d.p[0], topY + ah / 2, d.p[2]);
    g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6),
      new THREE.MeshStandardMaterial({ color: '#300406', emissive: new THREE.Color('#ff2233'), emissiveIntensity: 3 }));
    tip.position.set(d.p[0], topY + ah + 0.2, d.p[2]);
    g.add(tip);
    R.pulsers.push(tip);
  }
  if (h % 3 === 0 && d.size[1] > 14) {
    // neon strip partway up a facade
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(6, d.size[0] * 0.6), 1.1, 0.25),
      new THREE.MeshStandardMaterial({
        color: '#0a0d12',
        emissive: new THREE.Color(['#ff5da2', '#4dfff0', '#ffe14d', '#8aff6b'][h % 4]),
        emissiveIntensity: 2.6,
      })
    );
    neon.position.set(d.p[0], d.p[1] + d.size[1] * 0.18, d.p[2] + d.size[2] / 2 + 0.2);
    neon.rotation.y = d.yaw || 0;
    g.add(neon);
  }
}

// Backlit ad board bolted to a facade; falls with its building.
function addBillboard(R, g, d) {
  if (!R._adTex) R._adTex = [0, 1, 2].map((v) => makeAdTexture(v));
  const grp = new THREE.Group();
  const [bw, bh] = d.size;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.5, bh + 0.5, 0.25),
    new THREE.MeshStandardMaterial({ color: '#1a1d26', metalness: 0.7, roughness: 0.5 }));
  grp.add(frame);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh),
    new THREE.MeshStandardMaterial({
      color: '#05060a',
      emissive: new THREE.Color('#ffffff'), emissiveMap: R._adTex[d.v % 3], emissiveIntensity: 0.85,
      roughness: 0.6,
    }));
  face.position.z = 0.16;
  grp.add(face);
  grp.position.set(...d.p);
  if (d.yaw) grp.rotation.y = d.yaw;
  const deco = d.bldg != null && R.bldgDeco ? R.bldgDeco.get(d.bldg) : null;
  (deco || g).add(grp);
}

function makeAdTexture(variant) {
  // backlit signage: glyph blocks in a signature hue on near-black
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
