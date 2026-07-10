import * as THREE from 'three';
import {
  V3, lerp, lerpAngle, damp, clampN, bounce, mulberry32,
  organicDisplace,
} from './util.js';
import { chitinSet, hideSet, skinSet, featherSet, flareSprite } from './materials.js';

// KAIJU. Bodies are noise-displaced hulls (no two silhouettes read as a
// primitive) under authored organic texture sets: domed chitin plates with
// crack seams, wrinkled leather hide, wet blotched amphibian skin,
// scalloped feather rows. Animation behaviors unchanged.

const VIEW_STYLES = {
  crab: { cls: 'crab', scale: 1, shell: '#b8432e', belly: '#c98a6a', dark: '#5c1f14', scuttleRate: 9 },
  rusher: { cls: 'crab', scale: 0.55, shell: '#3aa88f', belly: '#7ec9b4', dark: '#175c4d', scuttleRate: 20 },
  tank: { cls: 'crab', scale: 1.75, shell: '#4d5361', belly: '#767c8a', dark: '#272b33', scuttleRate: 4, armored: true },
  boss: { cls: 'crab', scale: 2.6, shell: '#8f2440', belly: '#b56a6a', dark: '#42101f', scuttleRate: 5, crown: true },
  spitter: { cls: 'spitter' },
  flyer: { cls: 'flyer' },
  swarmling: { cls: 'swarm' },
  pigeon: { cls: 'pigeon' },
};

export function makeMonsterView(scene, type) {
  const st = VIEW_STYLES[type] || VIEW_STYLES.crab;
  if (st.cls === 'pigeon') return new PigeonView(scene);
  if (st.cls === 'spitter') return new SpitterView(scene);
  if (st.cls === 'flyer') return new FlyerView(scene);
  if (st.cls === 'swarm') return new SwarmView(scene);
  return new CrabView(scene, st);
}

// displaced hull cache — geometry is shared across every view of a type
const geoCache = new Map();
function organic(key, base, amount, freq, seed) {
  if (!geoCache.has(key)) geoCache.set(key, organicDisplace(base, amount, freq, seed));
  return geoCache.get(key);
}

function eyeGlow(color, scale = 1.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flareSprite(), color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

// ===========================================================================
// CRABZILLA — a giant, deeply furious crab.
// ===========================================================================
class CrabView {
  constructor(scene, style = VIEW_STYLES.crab) {
    this.scene = scene;
    this.style = style;
    this.baseScale = style.scale || 1;
    this.root = new THREE.Group();
    this.root.scale.setScalar(this.baseScale);
    scene.add(this.root);

    const chit = chitinSet(style.shell, style.dark);
    const shell = new THREE.MeshStandardMaterial({
      map: chit.map, normalMap: chit.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: chit.roughnessMap, roughness: 1.0, metalness: 0.06, envMapIntensity: 0.9,
    });
    const hide = hideSet(style.belly);
    const belly = new THREE.MeshStandardMaterial({
      map: hide.map, normalMap: hide.normalMap, roughness: 0.75, metalness: 0.03,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: style.dark, roughness: 0.45, metalness: 0.08, envMapIntensity: 0.8,
    });
    this.flashMats = [shell, belly, dark];

    // rocky displaced carapace
    const carapace = new THREE.Mesh(
      organic('crab-shell', new THREE.IcosahedronGeometry(3.3, 3), 0.4, 0.55, 3), shell);
    carapace.scale.set(1.05, 0.62, 0.92);
    carapace.position.y = 0.5;
    carapace.castShadow = true;
    this.root.add(carapace);
    // segmented lower body / mouth mass
    const under = new THREE.Mesh(
      organic('crab-under', new THREE.IcosahedronGeometry(2.4, 2), 0.22, 0.8, 11), belly);
    under.scale.set(1.0, 0.55, 0.75);
    under.position.y = -0.9;
    this.root.add(under);
    // serrated mandible plates at the front
    for (const s of [-1, 1]) {
      const mand = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 5), dark);
      mand.rotation.x = -Math.PI / 2.1; mand.rotation.z = s * 0.3;
      mand.position.set(s * 0.7, -0.4, -2.5);
      this.root.add(mand);
    }
    // ridge of back spikes down the carapace
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) / 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.5 - Math.abs(t) * 0.15, 1.6 + (1 - Math.abs(t)) * 1.1, 6), dark);
      spike.position.set(0, 1.7 - Math.abs(t) * 0.4, -0.2 + t * 1.6);
      spike.rotation.x = -0.2 + t * 0.25;
      this.root.add(spike);
      for (const s of [-1, 1]) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 5), shell);
        sp.position.set(s * (1.3 + Math.abs(t) * 0.3), 1.1 - Math.abs(t) * 0.3, -0.2 + t * 1.5);
        sp.rotation.x = -0.2; sp.rotation.z = s * 0.5;
        this.root.add(sp);
      }
    }

    // deep-set predator eyes under a heavy brow
    this.eyes = [];
    const brow = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.8), dark);
    brow.position.set(0, 1.75, -2.0); brow.rotation.x = 0.25;
    this.root.add(brow);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.26, 0.34),
        new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 1.15, 1.45, -2.25);
      eye.rotation.z = -s * 0.32;
      this.root.add(eye);
      const glow = eyeGlow('#ff2e3f', 1.7);
      glow.position.copy(eye.position).z -= 0.2;
      this.root.add(glow);
      this.eyes.push({ eye, glow });
    }

    // claws: heavy tapered arm + an open two-prong pincer
    this.claws = [];
    for (const s of [-1, 1]) {
      const armG = new THREE.Group();
      armG.position.set(s * 3.0, 0.3, -1.4);
      this.root.add(armG);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), dark);
      armG.add(shoulder);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.7, 4, 12), dark);
      arm.rotation.x = Math.PI / 2; arm.position.z = -1.2;
      armG.add(arm);
      // knuckle: displaced organic mass, not a box
      const knuckle = new THREE.Mesh(
        organic('crab-knuckle', new THREE.IcosahedronGeometry(1.15, 2), 0.28, 1.1, 21), shell);
      knuckle.scale.set(0.95, 0.78, 0.85);
      knuckle.position.z = -2.7; knuckle.castShadow = true;
      armG.add(knuckle);
      const upper = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 6), shell);
      upper.rotation.x = -Math.PI / 2; upper.position.set(0, 0.55, -4.0);
      armG.add(upper);
      const lower = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.3, 6), dark);
      lower.rotation.x = -Math.PI / 2; lower.position.set(0, -0.5, -3.9);
      armG.add(lower);
      this.claws.push(armG);
    }

    // legs: 3 jointed limbs per side
    this.legMeshes = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const legG = new THREE.Group();
        legG.position.set(s * 2.6, -0.4, -1.4 + i * 1.4);
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 4, 10), dark);
        thigh.rotation.z = s * 1.0; thigh.position.set(s * 0.8, -0.3, 0);
        legG.add(thigh);
        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 2.0, 4, 10), dark);
        shin.position.set(s * 1.7, -1.4, 0); shin.rotation.z = s * 0.25;
        legG.add(shin);
        const foot = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 5), shell);
        foot.position.set(s * 1.95, -2.5, 0);
        legG.add(foot);
        this.root.add(legG);
        this.legMeshes.push(legG);
      }
    }

    if (style.armored) {
      // riveted plates for the tank
      for (const [px, py, pz] of [[0, 1.5, 0], [-1.8, 0.9, -1.2], [1.8, 0.9, -1.2], [0, 0.9, 1.6]]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2),
          new THREE.MeshStandardMaterial({ color: '#3a3f4a', metalness: 0.8, roughness: 0.5 }));
        plate.position.set(px, py, pz);
        plate.rotation.y = px * 0.2;
        this.root.add(plate);
      }
    }
    if (style.crown) {
      // bosses get a tiny crown. it does nothing. it's perfect.
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: '#5c4408', emissive: new THREE.Color('#ffd166'), emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.3 }));
      crown.position.set(0, 4.2, -1.6);
      this.root.add(crown);
    }

    this.bar = makeHpBar(scene);
    this.scuttle = Math.random() * 9;
    this.flashT = 0;
  }

  flash() { this.flashT = 0.14; }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.bar.sprite);
  }

  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha);
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    // crabs walk sideways-ish: face 60° off their travel direction
    this.root.rotation.y = lerpAngle(this.root.rotation.y, (mb.yaw ?? 0) + 0.6, 0.15);

    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.14);
      for (const m of this.flashMats) m.emissive.setScalar(k * 0.85);
    }

    if (mb.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI, 5, dt);
      this.root.position.y = y - Math.min(2.2, (mb.t || 0) * 1.2) * this.baseScale;
      this.bar.sprite.visible = false;
      return;
    }
    const squash = this.flashT > 0 ? 1.12 : 1;
    if (mb.state === 'spawn') {
      const k = Math.min(1, (mb.t || 0) / 1.4);
      this.root.scale.setScalar((0.2 + 0.8 * bounce(k)) * this.baseScale);
    } else {
      this.root.scale.setScalar(this.baseScale * squash);
    }

    this.scuttle += dt * (this.style.scuttleRate || 9);
    this.legMeshes.forEach((leg, i) => {
      leg.rotation.x = Math.sin(this.scuttle + i * 1.1) * (mb.state === 'walk' ? 0.5 : 0.12);
    });

    const tele = mb.state === 'telegraph';
    const attacking = mb.state === 'attack';
    this.claws.forEach((c, i) => {
      let want = 0.15 + Math.sin(this.scuttle * 0.5 + i) * 0.1;
      if (tele) want = 1.5 + Math.sin(performance.now() / 60) * 0.12;
      if (attacking) want = -0.7;
      c.rotation.x = damp(c.rotation.x, want, tele ? 8 : 16, dt);
    });

    for (const e of this.eyes) {
      e.eye.material.color.set(tele ? '#ff6b3f' : '#ff2e3f');
      e.glow.material.opacity = tele ? 0.85 : 0.45 + Math.sin(this.scuttle) * 0.1;
    }

    this.bar.update(this.root.position, 5.2 * this.baseScale, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// SPITTER — a squat glob-lobbing toad that refuses to fight fair.
// ===========================================================================
class SpitterView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const skinT = skinSet('#5f7a2e', '#37481a');
    const skin = new THREE.MeshStandardMaterial({
      map: skinT.map, normalMap: skinT.normalMap, normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: skinT.roughnessMap, roughness: 1.0, metalness: 0.04, envMapIntensity: 1.2,
    });
    const bellyT = skinSet('#b6c96a', '#8fa84a');
    const belly = new THREE.MeshStandardMaterial({
      map: bellyT.map, normalMap: bellyT.normalMap,
      roughnessMap: bellyT.roughnessMap, roughness: 1.0, metalness: 0.04, envMapIntensity: 1.2,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#2c3d14', roughness: 0.5, metalness: 0.05 });
    this.flashMats = [skin, belly, dark];

    // warty displaced bulk
    const body = new THREE.Mesh(
      organic('spit-body', new THREE.IcosahedronGeometry(2.5, 3), 0.3, 0.7, 5), skin);
    body.scale.set(1.2, 0.82, 1.05);
    body.castShadow = true;
    this.root.add(body);
    // distended acid-sac throat that inflates before it spits
    this.throat = new THREE.Mesh(
      organic('spit-throat', new THREE.IcosahedronGeometry(1.5, 3), 0.18, 1.0, 8), belly);
    this.throat.position.set(0, -0.5, -1.7);
    this.root.add(this.throat);
    // gaping maw it fires through
    this.snout = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.25, 2.0, 8), dark);
    this.snout.rotation.x = Math.PI / 2.4;
    this.snout.position.set(0, 0.85, -2.2);
    this.root.add(this.snout);
    for (const s of [-1, 1]) {
      // bulging asymmetric eyes
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10),
        new THREE.MeshStandardMaterial({ color: '#3d4d10', emissive: new THREE.Color('#d3ff4d'), emissiveIntensity: 0.85, roughness: 0.2 }));
      eye.position.set(s * 1.15, 1.7, -1.1);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#10131f', roughness: 0.1 }));
      pupil.position.z = -0.4;
      eye.add(pupil);
      this.root.add(eye);
      // splayed webbed legs
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), dark);
      thigh.position.set(s * 2.1, -1.3, 0.4); thigh.rotation.z = s * 0.6;
      this.root.add(thigh);
      const foot = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 4), skin);
      foot.rotation.x = -Math.PI / 2; foot.position.set(s * 2.7, -1.9, -0.1);
      this.root.add(foot);
    }
    this.bar = makeHpBar(scene);
    this.flashT = 0;
    this.wob = Math.random() * 9;
  }
  flash() { this.flashT = 0.14; }
  dispose(scene) { scene.remove(this.root); scene.remove(this.bar.sprite); }
  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha);
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mb.yaw ?? 0, 0.15);
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.14) * 0.85);
    }
    if (mb.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI, 5, dt);
      this.root.position.y = y - Math.min(2, (mb.t || 0) * 1.2);
      this.bar.sprite.visible = false;
      return;
    }
    this.wob += dt * 4;
    const tele = mb.state === 'telegraph';
    const ts = tele ? 1 + Math.min(1, mb.t / 0.9) * 1.1 : 1 + Math.sin(this.wob) * 0.06;
    this.throat.scale.setScalar(ts);
    this.snout.rotation.x = damp(this.snout.rotation.x, tele ? Math.PI / 3.2 : Math.PI / 2.4, 8, dt);
    if (mb.state === 'spawn') this.root.scale.setScalar(0.2 + 0.8 * bounce(Math.min(1, mb.t / 1.2)));
    else this.root.scale.setScalar(1);
    this.bar.update(this.root.position, 4.6, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// FLYER — a leathery wyvern that circles high and dive-bombs.
// ===========================================================================
class FlyerView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const hideT = hideSet('#6b5240');
    const hide = new THREE.MeshStandardMaterial({
      map: hideT.map, normalMap: hideT.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.8, metalness: 0.03,
    });
    const memT = hideSet('#3a2b22');
    const membrane = new THREE.MeshStandardMaterial({
      map: memT.map, normalMap: memT.normalMap, roughness: 0.65, metalness: 0.03, side: THREE.DoubleSide,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#241a14', roughness: 0.55, metalness: 0.05 });
    this.flashMats = [hide, membrane, dark];

    const body = new THREE.Mesh(
      organic('fly-body', new THREE.IcosahedronGeometry(1.5, 2), 0.2, 1.0, 14), hide);
    body.scale.set(0.85, 0.8, 1.7);
    body.castShadow = true;
    this.root.add(body);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.1, 4, 10), hide);
    neck.position.set(0, 0.55, -1.7); neck.rotation.x = 1.15;
    this.root.add(neck);
    const head = new THREE.Mesh(
      organic('fly-head', new THREE.IcosahedronGeometry(0.72, 2), 0.12, 2.0, 17), hide);
    head.scale.set(0.9, 0.8, 1.3);
    head.position.set(0, 0.95, -2.7);
    this.root.add(head);
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 5), dark);
    jaw.rotation.x = -Math.PI / 2; jaw.position.set(0, 0.75, -3.6);
    this.root.add(jaw);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 5), dark);
      horn.position.set(s * 0.35, 1.5, -2.5); horn.rotation.z = s * 0.4; horn.rotation.x = -0.5;
      this.root.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ff8a1e' }));
      eye.position.set(s * 0.42, 1.05, -3.0);
      this.root.add(eye);
      const glow = eyeGlow('#ff8a1e', 0.9);
      glow.position.copy(eye.position);
      this.root.add(glow);
    }
    // barbed tail
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.ConeGeometry(0.4 - i * 0.08, 1.1, 6), hide);
      seg.rotation.x = Math.PI / 2; seg.position.set(0, 0.15 + i * 0.05, 1.6 + i * 0.95);
      this.root.add(seg);
    }
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 4), dark);
    barb.rotation.x = -Math.PI / 2; barb.position.set(0, 0.35, 5.6);
    this.root.add(barb);
    // membrane wings: leading-edge bone + finger struts + stretched membrane
    this.wings = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 1.0, 0.5, -0.3);
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 4.6, 6), dark);
      bone.rotation.z = Math.PI / 2; bone.position.set(s * 2.3, 0, 0);
      g.add(bone);
      const mem = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.4, 3), membrane);
      mem.rotation.z = s * Math.PI / 2; mem.rotation.y = Math.PI; mem.scale.set(1, 1, 0.08);
      mem.position.set(s * 2.2, -0.1, 0.7);
      g.add(mem);
      for (let f = 0; f < 3; f++) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 3.0, 5), dark);
        strut.position.set(s * (1.2 + f * 1.0), -0.3, 0.9);
        strut.rotation.x = -0.5; strut.rotation.z = s * 0.2;
        g.add(strut);
      }
      this.root.add(g);
      this.wings.push({ g, s });
    }
    this.bar = makeHpBar(scene);
    this.flap = Math.random() * 9;
    this.flashT = 0;
    this.vel = new V3();
    this.prev = new V3();
  }
  flash() { this.flashT = 0.14; }
  dispose(scene) { scene.remove(this.root); scene.remove(this.bar.sprite); }
  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha);
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    if (dt > 0) {
      this.vel.copy(this.root.position).sub(this.prev).divideScalar(Math.max(dt, 1e-4));
      this.prev.copy(this.root.position);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.14) * 0.85);
    }
    if (mb.state === 'dead') {
      this.root.rotation.z += dt * 6;
      this.bar.sprite.visible = false;
      return;
    }
    const speed = this.vel.length();
    if (speed > 1) {
      const yaw = Math.atan2(-this.vel.x, -this.vel.z);
      this.root.rotation.y = lerpAngle(this.root.rotation.y, yaw, 0.2);
      this.root.rotation.x = damp(this.root.rotation.x, clampN(this.vel.y / Math.max(4, speed), 0.9) * -1, 6, dt);
    }
    const diving = mb.state === 'attack';
    this.flap += dt * (diving ? 2 : mb.state === 'telegraph' ? 26 : 10);
    for (const w of this.wings) {
      w.g.rotation.z = diving ? w.s * 1.25 : Math.sin(this.flap) * 0.7 * w.s + w.s * 0.15;
    }
    this.bar.update(this.root.position, 3.4, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// SWARMLING — a fist-sized gremlin. Alone: adorable. In dozens: a problem.
// ===========================================================================
class SwarmView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const skinT = chitinSet('#a44fb5', '#5c2468');
    const skin = new THREE.MeshStandardMaterial({
      map: skinT.map, normalMap: skinT.normalMap,
      roughnessMap: skinT.roughnessMap, roughness: 1.0, metalness: 0.05,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#471a52', roughness: 0.6 });
    this.flashMats = [skin, dark];
    const body = new THREE.Mesh(
      organic('swarm-body', new THREE.IcosahedronGeometry(0.75, 2), 0.14, 2.2, 9), skin);
    body.scale.set(1, 0.9, 1.15);
    body.castShadow = true;
    this.root.add(body);
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 4), dark);
      sp.position.set(0, 0.6 - i * 0.12, -0.25 + i * 0.35);
      sp.rotation.x = -0.4 + i * 0.35;
      this.root.add(sp);
    }
    // single furious cyclops eye
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#4a3a10', emissive: new THREE.Color('#ffcf3f'), emissiveIntensity: 0.9, roughness: 0.3 }));
    eye.position.set(0, 0.22, -0.6);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6),
      new THREE.MeshStandardMaterial({ color: '#1d2033', roughness: 0.2 }));
    pupil.position.z = -0.22;
    eye.add(pupil);
    this.root.add(eye);
    for (const s of [-1, 0, 1]) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 4), dark);
      tooth.position.set(s * 0.22, -0.32, -0.62);
      tooth.rotation.x = 0.5;
      this.root.add(tooth);
    }
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.75, 4), dark);
      leg.position.set(s * 0.42, -0.7, 0);
      leg.rotation.x = Math.PI;
      this.root.add(leg);
      this.legs.push(leg);
    }
    this.run = Math.random() * 9;
    this.flashT = 0;
    this.bar = { update() {}, sprite: { visible: false } };
  }
  flash() { this.flashT = 0.12; }
  dispose(scene) { scene.remove(this.root); }
  apply(ma, mb, alpha, dt) {
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), lerp(ma.p[1], mb.p[1], alpha), lerp(ma.p[2], mb.p[2], alpha));
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mb.yaw ?? 0, 0.3);
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.12) * 0.9);
    }
    if (mb.state === 'dead') {
      this.root.scale.setScalar(Math.max(0.01, 1 - (mb.t || 0) * 1.4)); // pop!
      return;
    }
    this.run += dt * 22;
    this.legs[0].rotation.x = Math.sin(this.run) * 0.9;
    this.legs[1].rotation.x = Math.sin(this.run + Math.PI) * 0.9;
    if (mb.latched) {
      this.root.rotation.z = Math.sin(this.run * 0.7) * 0.35;
    }
  }
}

// ===========================================================================
// PIGEONZILLA — an enormous pigeon. The city's true apex predator.
// ===========================================================================
class PigeonView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    const featT = featherSet('#9aa3b2', '#c6ccd6');
    const grey = new THREE.MeshStandardMaterial({
      map: featT.map, normalMap: featT.normalMap, roughness: 0.75, metalness: 0.02,
    });
    const liteT = featherSet('#c6ccd6', '#e2e6ee');
    const lite = new THREE.MeshStandardMaterial({
      map: liteT.map, normalMap: liteT.normalMap, roughness: 0.75, metalness: 0.02,
    });
    // iridescent neck sheen — the one truly premium feature of any pigeon
    const green = new THREE.MeshPhysicalMaterial({
      color: '#3d7a5a', metalness: 0.7, roughness: 0.28,
      iridescence: 1.0, iridescenceIOR: 1.6, envMapIntensity: 1.6,
    });
    this.flashMats = [grey, lite];
    this.flashT = 0;

    const body = new THREE.Mesh(
      organic('pig-body', new THREE.IcosahedronGeometry(2.9, 3), 0.2, 0.7, 33), grey);
    body.scale.set(1, 0.95, 1.25);
    body.castShadow = true;
    body.position.y = 0.4;
    this.root.add(body);
    const chest = new THREE.Mesh(
      organic('pig-chest', new THREE.IcosahedronGeometry(2.1, 3), 0.15, 0.9, 35), lite);
    chest.position.set(0, -0.2, -1.4);
    this.root.add(chest);

    // fanned tail: overlapping feather slats
    for (let i = -2; i <= 2; i++) {
      const feather = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 2.8), i % 2 ? grey : lite);
      feather.position.set(i * 0.62, 0.8 + Math.abs(i) * 0.08, 3.4 + Math.abs(i) * -0.25);
      feather.rotation.x = 0.35;
      feather.rotation.y = i * 0.16;
      this.root.add(feather);
    }

    // wings: layered primary feathers on a shoulder pivot
    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      for (let f = 0; f < 4; f++) {
        const fe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.7 - f * 0.18, 3.4 - f * 0.5), f % 2 ? grey : lite);
        fe.position.set(s * f * 0.3, -0.85, 0.2 + f * 0.28);
        fe.rotation.y = s * f * 0.09;
        fe.castShadow = f === 0;
        wing.add(fe);
      }
      wing.position.set(s * 2.7, 1.6, 0.4);
      wing.rotation.z = s * 0.5;
      this.root.add(wing);
      this.wings.push({ mesh: wing, s });
    }

    // neck + head (the bob is everything)
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.6, -2.2);
    this.root.add(this.neck);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 2.4, 14), green);
    neckMesh.position.y = 1.0;
    this.neck.add(neckMesh);
    this.headG = new THREE.Group();
    this.headG.position.set(0, 2.4, 0);
    this.neck.add(this.headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 12), grey);
    head.castShadow = true;
    this.headG.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: '#e2984e', roughness: 0.35, metalness: 0.05 }));
    beak.position.set(0, -0.1, -1.6);
    beak.rotation.x = -Math.PI / 2;
    this.headG.add(beak);
    // predator sensor slits + armored brow plates
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.08),
        new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 0.68, 0.34, -1.04);
      eye.rotation.z = -s * 0.16;
      this.headG.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.2),
        new THREE.MeshStandardMaterial({ color: '#1d2033', roughness: 0.6 }));
      brow.position.set(s * 0.68, 0.62, -0.98);
      brow.rotation.z = -s * 0.32;
      this.headG.add(brow);
    }

    // legs
    for (const s of [-1, 1]) {
      const legM = new THREE.MeshStandardMaterial({ color: '#b23a4a', roughness: 0.55 });
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 10), legM);
      leg.position.set(s * 1.1, -2.4, 0);
      this.root.add(leg);
      const footM = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 1.7), legM);
      footM.position.set(s * 1.1, -3.5, -0.3);
      this.root.add(footM);
    }

    this.bar = makeHpBar(scene);
    this.bob = Math.random() * 9;
  }

  flash() { this.flashT = 0.14; }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.bar.sprite);
  }

  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha) + 0.6;
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mb.yaw ?? 0, 0.15);
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.14) * 0.85);
    }

    if (mb.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.9, 5, dt);
      this.root.position.y = y - Math.min(2.6, (mb.t || 0) * 1.4);
      this.bar.sprite.visible = false;
      return;
    }
    if (mb.state === 'spawn') {
      const k = Math.min(1, (mb.t || 0) / 1.4);
      this.root.scale.setScalar(0.2 + 0.8 * bounce(k));
    } else {
      this.root.scale.setScalar(1);
    }

    // THE BOB
    this.bob += dt * (mb.state === 'walk' ? 10 : 3);
    this.neck.position.z = -2.2 + Math.sin(this.bob) * 0.55;
    this.headG.rotation.x = Math.sin(this.bob) * 0.18;

    const tele = mb.state === 'telegraph';
    const attacking = mb.state === 'attack';
    if (tele && mb.kind === 'gust') {
      for (const w of this.wings) {
        w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 2.4 + Math.sin(performance.now() / 50) * 0.15, 10, dt);
      }
    } else if (attacking && mb.kind === 'gust') {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 0.3, 30, dt);
    } else {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 0.5, 8, dt);
    }
    if (tele && mb.kind !== 'gust') {
      this.neck.rotation.x = damp(this.neck.rotation.x, -0.55, 8, dt);
    } else if (attacking && mb.kind !== 'gust') {
      this.neck.rotation.x = damp(this.neck.rotation.x, 0.75, 30, dt);
    } else {
      this.neck.rotation.x = damp(this.neck.rotation.x, 0, 8, dt);
    }

    this.bar.update(this.root.position, 7.2, mb.hp / mb.maxHp);
  }
}

// ------------------------------------------------------------------ HP bar
// chamfered field-HUD bar: dark glass track, tick marks, health gradient
function makeHpBar(scene) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 16;
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(7, 0.9, 1);
  scene.add(sprite);
  let last = -1;
  const chamfer = (ctx, x, y, w, h, c) => {
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  };
  return {
    sprite,
    update(pos, height, frac) {
      sprite.visible = frac < 0.999;
      sprite.position.set(pos.x, pos.y + height, pos.z);
      if (Math.abs(frac - last) < 0.01) return;
      last = frac;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 128, 16);
      ctx.fillStyle = 'rgba(8,10,16,0.82)';
      chamfer(ctx, 0, 0, 128, 16, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(190,205,225,0.35)';
      ctx.lineWidth = 1.5;
      chamfer(ctx, 0.75, 0.75, 126.5, 14.5, 5); ctx.stroke();
      ctx.fillStyle = frac > 0.5 ? '#57c9a2' : frac > 0.25 ? '#e8b74d' : '#e05a52';
      chamfer(ctx, 3, 3, Math.max(6, 122 * frac), 10, 3); ctx.fill();
      // quarter ticks
      ctx.fillStyle = 'rgba(8,10,16,0.6)';
      for (const t of [0.25, 0.5, 0.75]) ctx.fillRect(3 + 122 * t, 3, 1.2, 10);
      tex.needsUpdate = true;
    },
  };
}
