import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ===========================================================================
// MONSTERFAB — original giant-creature views ("Abyssals": deep-water
// bio-titans that walked out of the trench).
//
// Every creature is an articulated hierarchy (hips/knees, shoulder/claw,
// neck/jaw, wing bones) with locomotion, telegraph, attack, stagger and
// death animation driven from server state. Bioluminescent vents mark the
// weak points; hit flashes and staggers read at combat distance.
// ===========================================================================

const V3 = THREE.Vector3;

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
function damp(cur, target, speed, dt) { return cur + (target - cur) * Math.min(1, speed * dt); }
function clampN(n, m) { return Math.max(-m, Math.min(m, n)); }
function bounce(t) {
  if (t < 0.6) return (t / 0.6) * 1.15;
  return 1.15 - 0.15 * ((t - 0.6) / 0.4);
}

// health bar sprite (canvas)
function makeHpBar(scene) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 18;
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(7, 1, 1);
  scene.add(sprite);
  let last = -1;
  return {
    sprite,
    update(pos, height, frac) {
      sprite.visible = frac < 0.999;
      sprite.position.set(pos.x, pos.y + height, pos.z);
      if (Math.abs(frac - last) < 0.01) return;
      last = frac;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 128, 18);
      ctx.fillStyle = 'rgba(10,12,22,0.85)';
      ctx.fillRect(0, 4, 128, 10);
      ctx.fillStyle = frac > 0.5 ? '#4dc9a0' : frac > 0.25 ? '#e8c35a' : '#e2543e';
      ctx.fillRect(2, 6, Math.max(4, 124 * frac), 6);
      tex.needsUpdate = true;
    },
  };
}

// organic hide: smooth-shaded sculpt from a distorted sphere — reads as
// muscle mass, not as an engine primitive
function hideGeo(r, sx, sy, sz, seed = 1, gnarl = 0.16) {
  const g = new THREE.SphereGeometry(r, 20, 16);
  const pos = g.attributes.position;
  const v = new V3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 2.1 + seed) * Math.sin(v.y * 2.7 + seed * 2) * Math.sin(v.z * 1.9 + seed * 3);
    const k = 1 + n * gnarl;
    pos.setXYZ(i, v.x * k * sx, v.y * k * sy, v.z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

// overlapping shell plate (bent, beveled disc segment)
function shellGeo(r, arc, seed = 0) {
  const g = new THREE.SphereGeometry(r, 12, 6, -arc / 2, arc, 0.35, 0.9);
  const pos = g.attributes.position;
  const v = new V3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3 + seed) * Math.sin(v.z * 3 + seed);
    pos.setXYZ(i, v.x, v.y * (1 + n * 0.1), v.z);
  }
  g.computeVertexNormals();
  return g;
}

function spikeGeo(r, len) {
  const g = new THREE.ConeGeometry(r, len, 6);
  g.computeVertexNormals();
  return g;
}

// ===========================================================================
// RAVAGER — the core Abyssal bruiser family (rusher / brute / tank / boss).
// A six-limbed reef-armored beast: four walking legs with real hip/knee
// articulation and two heavy claw arms for the telegraphed swipes.
// ===========================================================================
const RAVAGER_STYLES = {
  crab: { scale: 1.0, hide: '#7a4438', shell: '#4a2a24', glow: '#ff7b4d', gait: 7.5 },
  rusher: { scale: 0.52, hide: '#4d6e5c', shell: '#2c4438', glow: '#8affd0', gait: 16, lean: true },
  tank: { scale: 1.8, hide: '#565d68', shell: '#33383f', glow: '#ffb13f', gait: 3.6, armored: true },
  boss: { scale: 2.7, hide: '#6e3a4d', shell: '#3d1f2c', glow: '#ff4d6e', gait: 4.2, crested: true },
};

export class RavagerView {
  constructor(scene, type) {
    const st = RAVAGER_STYLES[type] || RAVAGER_STYLES.crab;
    this.st = st;
    this.scene = scene;
    this.baseScale = st.scale;
    this.root = new THREE.Group();
    this.root.scale.setScalar(st.scale);
    scene.add(this.root);

    const hide = new THREE.MeshStandardMaterial({ color: st.hide, roughness: 0.62, metalness: 0.06 });
    const shell = new THREE.MeshStandardMaterial({ color: st.shell, roughness: 0.4, metalness: 0.18 });
    const glowM = new THREE.MeshBasicMaterial({ color: st.glow });
    this.flashMats = [hide, shell];
    this.glowM = glowM;

    // ---- body: muscled torso sculpt, higher at the shoulders ----
    const body = new THREE.Mesh(hideGeo(2.9, 1.15, 0.78, 1.35, 3), hide);
    body.position.y = 0.6;
    body.castShadow = true;
    this.root.add(body);
    // overlapping dorsal shell plates
    const shellGeos = [];
    for (let i = 0; i < 4; i++) {
      const s = shellGeo(3.0 - i * 0.28, 2.4, i * 2);
      s.rotateY(-Math.PI / 2);
      s.translate(0, 1.15 - i * 0.12, -1.6 + i * 1.15);
      shellGeos.push(s);
    }
    const shellMesh = new THREE.Mesh(mergeGeometries(shellGeos), shell);
    shellMesh.castShadow = true;
    this.root.add(shellMesh);
    // bioluminescent vents along the shell seams — the weak line
    this.vents = [];
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.7, 3, 6), glowM);
      vent.rotation.z = Math.PI / 2;
      vent.position.set(0, 1.55 - i * 0.1, -1.0 + i * 1.1);
      this.root.add(vent);
      this.vents.push(vent);
    }
    // dorsal spines
    const spikes = [];
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) / 2;
      const sp = spikeGeo(0.32 - Math.abs(t) * 0.08, 1.5 + (1 - Math.abs(t)) * 1.0);
      sp.rotateX(-0.3 + t * 0.3);
      sp.translate(0, 2.0 - Math.abs(t) * 0.4, -0.2 + t * 1.7);
      spikes.push(sp);
      for (const s of [-1, 1]) {
        const side = spikeGeo(0.2, 0.9);
        side.rotateZ(s * 0.6);
        side.translate(s * (1.6 + Math.abs(t) * 0.2), 1.2 - Math.abs(t) * 0.3, -0.2 + t * 1.5);
        spikes.push(side);
      }
    }
    const spikeMesh = new THREE.Mesh(mergeGeometries(spikes), shell);
    this.root.add(spikeMesh);

    // ---- head: heavy brow, underbite jaw, sensor eyes ----
    this.headG = new THREE.Group();
    this.headG.position.set(0, 0.7, -2.6);
    this.root.add(this.headG);
    const skull = new THREE.Mesh(hideGeo(1.15, 1.0, 0.8, 1.1, 7, 0.12), hide);
    skull.castShadow = true;
    this.headG.add(skull);
    const brow = new THREE.Mesh(shellGeo(1.25, 2.2, 5), shell);
    brow.rotation.y = -Math.PI / 2;
    brow.position.set(0, 0.35, -0.1);
    this.headG.add(brow);
    this.jaw = new THREE.Mesh(hideGeo(0.85, 1.0, 0.5, 1.3, 11, 0.1), hide);
    this.jaw.position.set(0, -0.55, -0.5);
    this.headG.add(this.jaw);
    const teeth = [];
    for (let i = -2; i <= 2; i++) {
      const t = spikeGeo(0.09, 0.4);
      t.translate(i * 0.28, 0.25, -1.0);
      teeth.push(t);
    }
    this.jaw.add(new THREE.Mesh(mergeGeometries(teeth), shell));
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 3, 6), new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.rotation.z = Math.PI / 2 - s * 0.35;
      eye.position.set(s * 0.62, 0.3, -0.85);
      this.headG.add(eye);
      this.eyes.push(eye);
    }

    // ---- claw arms (telegraph/attack) ----
    this.claws = [];
    for (const s of [-1, 1]) {
      const armG = new THREE.Group();
      armG.position.set(s * 2.5, 0.55, -1.5);
      this.root.add(armG);
      const shoulder = new THREE.Mesh(hideGeo(0.8, 1, 1, 1, 5, 0.1), hide);
      armG.add(shoulder);
      const arm = new THREE.Mesh(hideGeo(0.62, 0.9, 0.9, 2.2, 9, 0.1), hide);
      arm.position.set(s * 0.4, -0.1, -1.4);
      arm.castShadow = true;
      armG.add(arm);
      // two-prong pincer with a working gap
      const upper = new THREE.Mesh(spikeGeo(0.5, 2.4), shell);
      upper.rotation.x = -Math.PI / 2;
      upper.position.set(s * 0.5, 0.5, -3.3);
      armG.add(upper);
      const lower = new THREE.Mesh(spikeGeo(0.44, 2.1), shell);
      lower.rotation.x = -Math.PI / 2;
      lower.position.set(s * 0.5, -0.45, -3.2);
      armG.add(lower);
      const knuckleGlow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glowM);
      knuckleGlow.position.set(s * 0.5, 0.1, -2.4);
      armG.add(knuckleGlow);
      this.claws.push(armG);
    }

    // ---- four walking legs with hip/knee articulation ----
    this.legs = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const hip = new THREE.Group();
        hip.position.set(s * 2.15, 0.15, -0.6 + i * 1.9);
        this.root.add(hip);
        const thigh = new THREE.Mesh(hideGeo(0.5, 0.8, 1.6, 0.8, 13 + i, 0.1), hide);
        thigh.position.set(s * 0.55, -0.55, 0);
        thigh.rotation.z = s * 0.65;
        thigh.castShadow = true;
        hip.add(thigh);
        const knee = new THREE.Group();
        knee.position.set(s * 1.25, -1.15, 0);
        hip.add(knee);
        const shin = new THREE.Mesh(hideGeo(0.3, 0.7, 1.9, 0.7, 17 + i, 0.08), hide);
        shin.position.set(s * 0.15, -1.0, 0);
        shin.rotation.z = -s * 0.18;
        knee.add(shin);
        const claw = new THREE.Mesh(spikeGeo(0.24, 0.8), shell);
        claw.position.set(s * 0.3, -2.05, 0);
        claw.rotation.z = Math.PI;
        knee.add(claw);
        this.legs.push({ hip, knee, s, ph: (i + (s > 0 ? 0.5 : 0)) * Math.PI });
      }
    }

    if (st.armored) {
      // bulwark titan: riveted siege plates bolted onto the shell
      const plates = [];
      for (const [px, py, pz, ry] of [[0, 1.8, 0.3, 0], [-1.9, 1.0, -1.0, 0.5], [1.9, 1.0, -1.0, -0.5], [0, 1.2, 1.9, 0]]) {
        const p = new THREE.BoxGeometry(2.2, 0.5, 1.9);
        p.rotateY(ry);
        p.translate(px, py, pz);
        plates.push(p);
      }
      const m = new THREE.Mesh(mergeGeometries(plates),
        new THREE.MeshStandardMaterial({ color: '#3d434f', metalness: 0.7, roughness: 0.45 }));
      m.castShadow = true;
      this.root.add(m);
    }
    if (st.crested) {
      // boss: tall blade crest + heavier glow
      const crest = new THREE.Mesh(shellGeo(2.2, 1.6, 21), shell);
      crest.rotation.set(0.5, -Math.PI / 2, 0);
      crest.position.set(0, 2.6, -1.2);
      crest.scale.set(1, 2.2, 1);
      this.root.add(crest);
      for (const v of this.vents) v.scale.setScalar(1.6);
    }

    this.bar = makeHpBar(scene);
    this.gaitT = Math.random() * 9;
    this.flashT = 0;
    this.staggerT = 0;
  }

  flash() { this.flashT = 0.14; this.staggerT = 0.28; }
  dispose(scene) { scene.remove(this.root); scene.remove(this.bar.sprite); }

  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha);
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mb.yaw ?? 0, 0.15);

    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.14);
      for (const m of this.flashMats) m.emissive.setScalar(k * 0.7);
    }
    // stagger: a hit rocks the whole body back on its hips
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.root.rotation.x = Math.sin(this.staggerT * 22) * 0.05 * (this.staggerT / 0.28);
    } else {
      this.root.rotation.x = damp(this.root.rotation.x, 0, 8, dt);
    }

    if (mb.state === 'dead') {
      // collapse: legs give out, body keels sideways and settles
      const k = Math.min(1, (mb.t || 0) * 0.9);
      this.root.rotation.z = damp(this.root.rotation.z, 1.35, 4, dt);
      this.root.position.y = y - k * 1.6 * this.baseScale;
      for (const L of this.legs) { L.hip.rotation.x = damp(L.hip.rotation.x, 0.8 * L.s, 5, dt); }
      this.glowM.color.lerp(new THREE.Color('#1a1418'), Math.min(1, dt * 2));
      this.bar.sprite.visible = false;
      return;
    }
    if (mb.state === 'spawn') {
      const k = Math.min(1, (mb.t || 0) / 1.4);
      this.root.scale.setScalar((0.2 + 0.8 * bounce(k)) * this.baseScale);
    } else {
      this.root.scale.setScalar(this.baseScale * (this.flashT > 0 ? 1.06 : 1));
    }

    // ---- gait: diagonal pairs, hip swing + knee lift ----
    const moving = mb.state === 'walk' || mb.state === 'spawn';
    this.gaitT += dt * this.st.gait * (moving ? 1 : 0.25);
    for (const L of this.legs) {
      const ph = this.gaitT + L.ph;
      const swing = moving ? 0.45 : 0.08;
      L.hip.rotation.x = Math.sin(ph) * swing;
      L.knee.rotation.x = Math.max(0, Math.sin(ph + 1.1)) * swing * 1.3;
    }
    // body bobs with the gait; head counter-bobs slightly
    this.headG.position.y = 0.7 + Math.sin(this.gaitT * 2) * 0.05;
    this.headG.rotation.x = clampN(Math.sin(this.gaitT) * 0.04, 0.3);

    // ---- claws: raise + tremble in telegraph, slam through attack ----
    const tele = mb.state === 'telegraph';
    const attacking = mb.state === 'attack';
    this.claws.forEach((c, i) => {
      let want = 0.15 + Math.sin(this.gaitT * 0.5 + i) * 0.1;
      if (tele) want = 1.5 + Math.sin(performance.now() / 55) * 0.14;
      if (attacking) want = -0.8;
      c.rotation.x = damp(c.rotation.x, want, tele ? 8 : attacking ? 30 : 12, dt);
    });
    // jaw gapes during telegraph
    this.jaw.rotation.x = damp(this.jaw.rotation.x, tele ? 0.55 : attacking ? 0.15 : 0.05, 10, dt);
    // eyes/vents run hot in telegraph
    for (const e of this.eyes) e.material.color.set(tele ? '#ff6b3f' : '#ff2e3f');
    const ventPulse = tele ? 1.6 + Math.sin(performance.now() / 60) * 0.4 : 1;
    for (const v of this.vents) v.scale.setScalar((this.st.crested ? 1.6 : 1) * ventPulse);

    this.bar.update(this.root.position, 5.4 * this.baseScale, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// STORMCALLER — heavy winged brute (replaces the comedy pigeon): a scarred
// storm-raptor whose wing-blast is the gust attack.
// ===========================================================================
export class StormcallerView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    const plume = new THREE.MeshStandardMaterial({ color: '#3d4450', roughness: 0.7, metalness: 0.05 });
    const plumeLt = new THREE.MeshStandardMaterial({ color: '#5d6673', roughness: 0.65, metalness: 0.05 });
    const iri = new THREE.MeshStandardMaterial({ color: '#2c5d68', metalness: 0.75, roughness: 0.25, emissive: new THREE.Color('#12333d'), emissiveIntensity: 0.5 });
    this.flashMats = [plume, plumeLt, iri];
    this.flashT = 0;

    const body = new THREE.Mesh(hideGeo(2.9, 1.0, 0.95, 1.3, 4, 0.1), plume);
    body.castShadow = true;
    body.position.y = 0.4;
    this.root.add(body);
    const chest = new THREE.Mesh(hideGeo(2.1, 1, 1, 1, 8, 0.12), plumeLt);
    chest.position.set(0, -0.2, -1.4);
    this.root.add(chest);

    // tail: layered feather blades
    const tailG = [];
    for (let i = -2; i <= 2; i++) {
      const f = new THREE.BoxGeometry(0.8, 0.14, 2.9);
      f.rotateY(i * 0.16);
      f.rotateX(0.35);
      f.translate(i * 0.6, 0.8 + Math.abs(i) * 0.08, 3.4 - Math.abs(i) * 0.25);
      tailG.push(f);
    }
    this.root.add(new THREE.Mesh(mergeGeometries(tailG), plume));

    // wings: layered primaries on shoulder pivots
    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      const feathers = [];
      for (let f = 0; f < 5; f++) {
        const fe = new THREE.BoxGeometry(0.3, 1.7 - f * 0.16, 3.6 - f * 0.5);
        fe.translate(s * f * 0.3, -0.85, 0.2 + f * 0.28);
        feathers.push(fe);
      }
      const m = new THREE.Mesh(mergeGeometries(feathers), plume);
      m.castShadow = true;
      wing.add(m);
      wing.position.set(s * 2.7, 1.6, 0.4);
      wing.rotation.z = s * 0.5;
      this.root.add(wing);
      this.wings.push({ mesh: wing, s });
    }

    // neck + war-scarred head
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.6, -2.2);
    this.root.add(this.neck);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.15, 2.4, 10), iri);
    neckMesh.position.y = 1.0;
    this.neck.add(neckMesh);
    this.headG = new THREE.Group();
    this.headG.position.set(0, 2.4, 0);
    this.neck.add(this.headG);
    const head = new THREE.Mesh(hideGeo(1.15, 1, 0.9, 1.1, 6, 0.1), plume);
    head.castShadow = true;
    this.headG.add(head);
    const beak = new THREE.Mesh(spikeGeo(0.45, 1.8), new THREE.MeshStandardMaterial({ color: '#22262e', metalness: 0.4, roughness: 0.35 }));
    beak.position.set(0, -0.15, -1.6);
    beak.rotation.x = -Math.PI / 2;
    this.headG.add(beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.08), new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 0.62, 0.3, -0.95);
      eye.rotation.z = -s * 0.16;
      this.headG.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.15, 0.2), new THREE.MeshStandardMaterial({ color: '#1d2028' }));
      brow.position.set(s * 0.62, 0.55, -0.9);
      brow.rotation.z = -s * 0.3;
      this.headG.add(brow);
    }

    // talon legs
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 2.4, 8),
        new THREE.MeshStandardMaterial({ color: '#57423a', roughness: 0.6 }));
      leg.position.set(s * 1.1, -2.4, 0);
      this.root.add(leg);
      const talons = [];
      for (let tt = -1; tt <= 1; tt++) {
        const t = spikeGeo(0.14, 0.9);
        t.rotateX(Math.PI / 2 + 0.3);
        t.translate(s * 1.1 + tt * 0.3, -3.5, -0.6);
        talons.push(t);
      }
      this.root.add(new THREE.Mesh(mergeGeometries(talons), new THREE.MeshStandardMaterial({ color: '#22262e', metalness: 0.3, roughness: 0.4 })));
    }

    this.bar = makeHpBar(scene);
    this.bob = Math.random() * 9;
  }

  flash() { this.flashT = 0.14; }
  dispose(scene) { scene.remove(this.root); scene.remove(this.bar.sprite); }

  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha) + 0.6;
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mb.yaw ?? 0, 0.15);
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.14) * 0.7);
    }
    if (mb.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.9, 5, dt);
      this.root.position.y = y - Math.min(2.6, (mb.t || 0) * 1.4);
      this.bar.sprite.visible = false;
      return;
    }
    if (mb.state === 'spawn') {
      this.root.scale.setScalar(0.2 + 0.8 * bounce(Math.min(1, (mb.t || 0) / 1.4)));
    } else this.root.scale.setScalar(1);

    // stalking head-sway
    this.bob += dt * (mb.state === 'walk' ? 9 : 3);
    this.neck.position.z = -2.2 + Math.sin(this.bob) * 0.5;
    this.headG.rotation.x = Math.sin(this.bob) * 0.15;

    const tele = mb.state === 'telegraph';
    const attacking = mb.state === 'attack';
    if (tele && mb.kind === 'gust') {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 2.4 + Math.sin(performance.now() / 50) * 0.15, 10, dt);
    } else if (attacking && mb.kind === 'gust') {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 0.25, 30, dt);
    } else {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 0.5 + Math.sin(this.bob * 0.4) * 0.05, 8, dt);
    }
    if (tele && mb.kind !== 'gust') this.neck.rotation.x = damp(this.neck.rotation.x, -0.55, 8, dt);
    else if (attacking && mb.kind !== 'gust') this.neck.rotation.x = damp(this.neck.rotation.x, 0.75, 30, dt);
    else this.neck.rotation.x = damp(this.neck.rotation.x, 0, 8, dt);

    this.bar.update(this.root.position, 7.2, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// BILE SPITTER — squat amphibian artillery. Throat sac inflates on the
// telegraph; maw angles up to lob.
// ===========================================================================
export class SpitterView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const skin = new THREE.MeshStandardMaterial({ color: '#55702c', roughness: 0.32, metalness: 0.05 });
    const belly = new THREE.MeshStandardMaterial({ color: '#a7bd5e', roughness: 0.28, metalness: 0.05, emissive: new THREE.Color('#2c3d0a'), emissiveIntensity: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#324a18', roughness: 0.5 });
    this.flashMats = [skin, belly, dark];

    const body = new THREE.Mesh(hideGeo(2.5, 1.2, 0.82, 1.05, 5, 0.2), skin);
    body.castShadow = true;
    this.root.add(body);
    this.throat = new THREE.Mesh(hideGeo(1.5, 1, 1, 1, 9, 0.14), belly);
    this.throat.position.set(0, -0.5, -1.7);
    this.root.add(this.throat);
    this.snout = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.25, 2.0, 9), dark);
    this.snout.rotation.x = Math.PI / 2.4;
    this.snout.position.set(0, 0.85, -2.2);
    this.root.add(this.snout);
    const warts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const w = hideGeo(0.26 + (i % 3) * 0.1, 1, 1, 1, i, 0.2);
      w.translate(Math.cos(a) * 1.7, 1.2 + Math.sin(i) * 0.5, Math.sin(a) * 1.3 + 0.2);
      warts.push(w);
    }
    this.root.add(new THREE.Mesh(mergeGeometries(warts), dark));
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: '#d3ff4d' }));
      eye.position.set(s * 1.15, 1.7, -1.1);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshStandardMaterial({ color: '#1d2033' }));
      pupil.position.z = -0.36;
      eye.add(pupil);
      this.root.add(eye);
      const thigh = new THREE.Mesh(hideGeo(0.5, 0.9, 1.4, 0.9, 3 + s, 0.12), dark);
      thigh.position.set(s * 2.1, -1.3, 0.4);
      thigh.rotation.z = s * 0.6;
      this.root.add(thigh);
      const foot = new THREE.Mesh(spikeGeo(0.65, 0.5), skin);
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(s * 2.7, -1.9, -0.1);
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
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.14) * 0.7);
    }
    if (mb.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI, 5, dt);
      this.root.position.y = y - Math.min(2, (mb.t || 0) * 1.2);
      this.bar.sprite.visible = false;
      return;
    }
    this.wob += dt * 4;
    const tele = mb.state === 'telegraph';
    const ts = tele ? 1 + Math.min(1, mb.t / 0.9) * 1.15 : 1 + Math.sin(this.wob) * 0.06;
    this.throat.scale.setScalar(ts);
    this.snout.rotation.x = damp(this.snout.rotation.x, tele ? Math.PI / 3.2 : Math.PI / 2.4, 8, dt);
    if (mb.state === 'spawn') this.root.scale.setScalar(0.2 + 0.8 * bounce(Math.min(1, mb.t / 1.2)));
    else this.root.scale.setScalar(1);
    this.bar.update(this.root.position, 4.6, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// RAZORWING — lean membrane-winged diver.
// ===========================================================================
export class FlyerView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const hide = new THREE.MeshStandardMaterial({ color: '#5d4636', roughness: 0.6 });
    const membrane = new THREE.MeshStandardMaterial({ color: '#33251d', roughness: 0.7, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: '#211710', roughness: 0.55 });
    this.flashMats = [hide, membrane, dark];

    const body = new THREE.Mesh(hideGeo(1.5, 0.85, 0.8, 1.7, 6, 0.12), hide);
    body.castShadow = true;
    this.root.add(body);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.1, 4, 10), hide);
    neck.position.set(0, 0.55, -1.7);
    neck.rotation.x = 1.15;
    this.root.add(neck);
    const head = new THREE.Mesh(hideGeo(0.72, 0.9, 0.8, 1.3, 2, 0.1), hide);
    head.position.set(0, 0.95, -2.7);
    this.root.add(head);
    const jaw = new THREE.Mesh(spikeGeo(0.38, 1.4), dark);
    jaw.rotation.x = -Math.PI / 2;
    jaw.position.set(0, 0.75, -3.6);
    this.root.add(jaw);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(spikeGeo(0.15, 0.9), dark);
      horn.position.set(s * 0.35, 1.5, -2.5);
      horn.rotation.z = s * 0.4;
      horn.rotation.x = -0.5;
      this.root.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff8a1e' }));
      eye.position.set(s * 0.42, 1.05, -3.0);
      this.root.add(eye);
    }
    const tailG = [];
    for (let i = 0; i < 4; i++) {
      const seg = spikeGeo(0.38 - i * 0.08, 1.1);
      seg.rotateX(Math.PI / 2);
      seg.translate(0, 0.15 + i * 0.05, 1.6 + i * 0.95);
      tailG.push(seg);
    }
    const barb = spikeGeo(0.32, 1.0);
    barb.rotateX(-Math.PI / 2);
    barb.translate(0, 0.35, 5.6);
    tailG.push(barb);
    this.root.add(new THREE.Mesh(mergeGeometries(tailG), hide));

    this.wings = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 1.0, 0.5, -0.3);
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.09, 4.6, 6), dark);
      bone.rotation.z = Math.PI / 2;
      bone.position.set(s * 2.3, 0, 0);
      g.add(bone);
      const mem = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.4, 3), membrane);
      mem.rotation.z = s * Math.PI / 2;
      mem.rotation.y = Math.PI;
      mem.scale.set(1, 1, 0.08);
      mem.position.set(s * 2.2, -0.1, 0.7);
      g.add(mem);
      for (let f = 0; f < 3; f++) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 3.0, 5), dark);
        strut.position.set(s * (1.2 + f * 1.0), -0.3, 0.9);
        strut.rotation.x = -0.5;
        strut.rotation.z = s * 0.2;
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
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.14) * 0.7);
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
// GNASHER — swarm parasite. Dozens at once; stays cheap but reads as a
// spined leech, not a ball.
// ===========================================================================
export class SwarmView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const skin = new THREE.MeshStandardMaterial({ color: '#8f42a3', roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#4d1e59', roughness: 0.6 });
    this.flashMats = [skin, dark];
    const body = new THREE.Mesh(hideGeo(0.75, 1, 0.9, 1.15, 3, 0.22), skin);
    body.castShadow = true;
    this.root.add(body);
    const spines = [];
    for (let i = 0; i < 3; i++) {
      const sp = spikeGeo(0.13, 0.55);
      sp.rotateX(-0.4 + i * 0.35);
      sp.translate(0, 0.6 - i * 0.12, -0.25 + i * 0.35);
      spines.push(sp);
    }
    for (const s of [-1, 0, 1]) {
      const tooth = spikeGeo(0.06, 0.28);
      tooth.rotateX(0.5);
      tooth.translate(s * 0.22, -0.32, -0.62);
      spines.push(tooth);
    }
    this.root.add(new THREE.Mesh(mergeGeometries(spines), dark));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffcf3f' }));
    eye.position.set(0, 0.22, -0.6);
    this.root.add(eye);
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(spikeGeo(0.15, 0.75), dark);
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
      for (const m of this.flashMats) m.emissive.setScalar(Math.max(0, this.flashT / 0.12) * 0.8);
    }
    if (mb.state === 'dead') {
      this.root.scale.setScalar(Math.max(0.01, 1 - (mb.t || 0) * 1.4));
      return;
    }
    this.run += dt * 22;
    this.legs[0].rotation.x = Math.PI + Math.sin(this.run) * 0.9;
    this.legs[1].rotation.x = Math.PI + Math.sin(this.run + Math.PI) * 0.9;
    if (mb.latched) this.root.rotation.z = Math.sin(this.run * 0.7) * 0.35;
  }
}

export function makeMonsterView(scene, type) {
  switch (type) {
    case 'pigeon': return new StormcallerView(scene);
    case 'spitter': return new SpitterView(scene);
    case 'flyer': return new FlyerView(scene);
    case 'swarmling': return new SwarmView(scene);
    default: return new RavagerView(scene, type);   // crab | rusher | tank | boss
  }
}
