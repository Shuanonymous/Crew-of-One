import * as THREE from 'three';
import { MECH } from '/shared/constants.js';

// Everything visual. Style goals: bold flat colors, chunky low-poly
// shapes, a painterly gradient sky, and a mech that reads as HEAVY.

const V3 = THREE.Vector3;

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog('#f2a08a', 90, 300);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 600);
    this.camDist = 30;
    this.trauma = 0;          // screen shake fuel
    this.camPos = new V3(0, 20, 40);

    const hemi = new THREE.HemisphereLight('#ffe8c9', '#6b5d8f', 1.0);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffd9a0', 1.7);
    this.sun.position.set(60, 90, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const S = 90;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.far = 300;
    this.scene.add(this.sun);

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.mechViews = new Map();
    this.monsterViews = new Map();
    this.crateMeshes = [];
    this.ringViews = [];
    this.balloonView = null;
    this.particles = [];
    this.windowTex = makeWindowTexture();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  shake(amount) { this.trauma = Math.min(1.4, this.trauma + amount); }

  // ------------------------------------------------------------ world
  clearWorld() {
    this.scene.remove(this.worldGroup);
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    for (const v of this.mechViews.values()) v.dispose(this.scene);
    for (const v of this.monsterViews.values()) v.dispose(this.scene);
    this.mechViews.clear();
    this.monsterViews.clear();
    this.crateMeshes = [];
    this.ringViews = [];
    this.balloonView = null;
  }

  buildWorld(world) {
    this.clearWorld();
    const g = this.worldGroup;

    for (const d of world.city) {
      if (d.kind === 'ground') {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(...d.size),
          new THREE.MeshLambertMaterial({ color: d.color })
        );
        mesh.position.set(...d.p);
        mesh.receiveShadow = true;
        g.add(mesh);
      } else if (d.kind === 'disc') {
        const mesh = new THREE.Mesh(
          new THREE.CircleGeometry(d.size[0], 40),
          new THREE.MeshLambertMaterial({ color: d.color })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(...d.p);
        mesh.receiveShadow = true;
        g.add(mesh);
      } else if (d.kind === 'building') {
        const mat = new THREE.MeshLambertMaterial({ color: d.color, map: d.windows ? this.windowTex : null });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...d.size), mat);
        mesh.position.set(...d.p);
        mesh.rotation.y = d.yaw || 0;
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        // flat roof slab, slightly darker — sells the chunky look
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(d.size[0] + 0.7, 0.8, d.size[2] + 0.7),
          new THREE.MeshLambertMaterial({ color: shade(d.color, 0.72) })
        );
        roof.position.set(d.p[0], d.p[1] + d.size[1] / 2 + 0.4, d.p[2]);
        roof.rotation.y = d.yaw || 0;
        g.add(roof);
      }
    }

    // training props
    if (world.rings) {
      for (const r of world.rings) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(6, 0.65, 10, 32),
          new THREE.MeshBasicMaterial({ color: '#f5d76e' })
        );
        ring.position.set(r.p[0], 7, r.p[2]);
        g.add(ring);
        this.ringViews.push(ring);
      }
    }
    if (world.balloon) {
      const b = new THREE.Group();
      const ball = new THREE.Mesh(
        new THREE.IcosahedronGeometry(world.balloon.radius, 1),
        new THREE.MeshLambertMaterial({ color: '#ef767a', flatShading: true })
      );
      b.add(ball);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 6),
        new THREE.MeshLambertMaterial({ color: '#c0392b' }));
      knot.position.y = -world.balloon.radius - 0.4;
      knot.rotation.x = Math.PI;
      b.add(knot);
      b.position.set(...world.balloon.p);
      g.add(b);
      this.balloonView = b;
    }
    if (world.crateSize) {
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(
          new THREE.BoxGeometry(world.crateSize, world.crateSize, world.crateSize),
          new THREE.MeshLambertMaterial({ color: ['#e9c46a', '#e76f51', '#2a9d8f', '#c78bd6'][i] })
        );
        c.castShadow = c.receiveShadow = true;
        g.add(c);
        this.crateMeshes.push(c);
      }
    }

    // decorative confetti of tiny "cars" parked around the plaza
    const rng = mulberry32(99);
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2;
      const r = (world.arenaRadius || 48) * (0.5 + rng() * 0.45);
      const car = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 1.1, 1.4),
        new THREE.MeshLambertMaterial({ color: ['#ef767a', '#7d9df0', '#f5d76e', '#6fc2a0', '#ffffff'][i % 5] })
      );
      car.position.set(Math.cos(a) * r, 0.55, Math.sin(a) * r);
      car.rotation.y = rng() * Math.PI * 2;
      car.castShadow = true;
      g.add(car);
    }
  }

  // ------------------------------------------------------ interpolation
  applySample(sample, dt, myMechId) {
    const { a, b, alpha } = sample;

    for (const mb of b.mechs) {
      const ma = a.mechs.find((m) => m.id === mb.id) || mb;
      let view = this.mechViews.get(mb.id);
      if (!view) {
        view = new MechView(this.scene, mb.color);
        this.mechViews.set(mb.id, view);
      }
      view.apply(ma, mb, alpha, dt);
    }

    const seen = new Set();
    for (const mb of b.monsters) {
      seen.add(mb.id);
      const ma = a.monsters.find((m) => m.id === mb.id) || mb;
      let view = this.monsterViews.get(mb.id);
      if (!view) {
        view = mb.type === 'pigeon' ? new PigeonView(this.scene) : new CrabView(this.scene);
        this.monsterViews.set(mb.id, view);
      }
      view.apply(ma, mb, alpha, dt);
    }
    for (const [id, view] of this.monsterViews) {
      if (!seen.has(id)) { view.dispose(this.scene); this.monsterViews.delete(id); }
    }

    if (b.crates && this.crateMeshes.length) {
      b.crates.forEach((c, i) => {
        const mesh = this.crateMeshes[i];
        if (!mesh) return;
        const ca = (a.crates || b.crates)[i] || c;
        mesh.position.set(lerp(ca.p[0], c.p[0], alpha), lerp(ca.p[1], c.p[1], alpha), lerp(ca.p[2], c.p[2], alpha));
        mesh.quaternion.set(...c.q);
      });
    }
    if (b.objectives) {
      b.objectives.rings.forEach((done, i) => {
        const ring = this.ringViews[i];
        if (ring) {
          ring.material.color.set(done ? '#2a9d8f' : '#f5d76e');
          if (!done) ring.rotation.y += dt * 1.5;
        }
      });
      if (this.balloonView) this.balloonView.visible = !b.objectives.balloon;
    }

    this.stepParticles(dt);
  }

  // one-shot effect hooks (called by main on snapshot events)
  burst(pos, color, n = 14, speed = 14) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshBasicMaterial({ color })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new V3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8 + 4, (Math.random() - 0.5) * speed),
        life: 0.9 + Math.random() * 0.5,
      });
    }
  }

  dust(pos, n = 8) { this.burst(pos, '#cbb9a0', n, 8); }

  stepParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vel.y -= 30 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.z += dt * 4;
      const s = Math.max(0.01, Math.min(1, p.life));
      p.mesh.scale.setScalar(s);
      if (p.life <= 0) this.scene.remove(p.mesh);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------- camera
  updateCamera(yaw, pitch, myMechId, dt) {
    const view = this.mechViews.get(myMechId) || this.mechViews.values().next().value;
    const target = view ? view.root.position.clone() : new V3();
    target.y += 9;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = new V3(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    const pos = target.clone().sub(dir.multiplyScalar(this.camDist));
    if (pos.y < 1.2) pos.y = 1.2;
    this.camPos.lerp(pos, Math.min(1, dt * 10));

    // screen shake: heavy things make the WORLD move
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const t2 = this.trauma * this.trauma;
    const off = new V3(
      (Math.random() - 0.5) * 2 * t2,
      (Math.random() - 0.5) * 2 * t2,
      (Math.random() - 0.5) * 1.2 * t2
    );
    this.camera.position.copy(this.camPos).add(off);
    this.camera.lookAt(target.add(off.clone().multiplyScalar(0.5)));
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

// ===========================================================================
// MECH — chunky, boxy, heavy. Reads from snapshot state; animates locally.
// ===========================================================================
class MechView {
  constructor(scene, color = '#f5b13d') {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    const main = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: '#2b2d42' });
    const trim = new THREE.MeshLambertMaterial({ color: '#fdf6ec' });
    this.mats = { main, dark, trim };

    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.6, 2.8), main);
    torso.castShadow = true;
    this.root.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 0.4), trim);
    chest.position.set(0, 0.9, -1.5);
    this.root.add(chest);
    const vents = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.3), dark);
    vents.position.set(0, -1.6, -1.45);
    this.root.add(vents);

    // shoulder pads
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.6, 2.4), dark);
      pad.position.set(side * 2.9, 2.4, 0);
      pad.castShadow = true;
      this.root.add(pad);
    }

    // head: visor + one BIG eye that charges up
    this.head = new THREE.Group();
    this.head.position.set(0, 3.9, 0);
    this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.7, 1.9), main);
    skull.castShadow = true;
    this.head.add(skull);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 0.3), dark);
    visor.position.set(0, 0.12, -0.95);
    this.head.add(visor);
    this.eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#c78bd6' })
    );
    this.eye.position.set(0, 0.12, -1.05);
    this.head.add(this.eye);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1), dark);
    antenna.position.set(0.7, 1.3, 0);
    this.head.add(antenna);
    this.bobble = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshLambertMaterial({ color: '#ef767a' }));
    this.bobble.position.set(0.7, 1.95, 0);
    this.head.add(this.bobble);

    // legs
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 1.25, -2.8, 0);
      this.root.add(hip);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 1.7), dark);
      thigh.position.y = -1.3;
      thigh.castShadow = true;
      hip.add(thigh);
      const shinG = new THREE.Group();
      shinG.position.y = -2.6;
      hip.add(shinG);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 1.4), main);
      shin.position.y = -1.1;
      shin.castShadow = true;
      shinG.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 2.6), dark);
      foot.position.set(0, -2.4, -0.35);
      foot.castShadow = true;
      shinG.add(foot);
      this.legs.push({ hip, shinG, side });
    }
    this.walkPhase = 0;

    // arms: world-space segments (shoulder -> elbow -> fist)
    this.arms = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 1), dark);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 1), main);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.66, 10, 8), dark);
      const fist = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), trim);
      upper.castShadow = fore.castShadow = fist.castShadow = true;
      scene.add(upper, fore, elbow, fist);
      this.arms[side] = { s, upper, fore, elbow, fist, pos: new V3() };
    }

    // laser beam
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1, 10),
      new THREE.MeshBasicMaterial({ color: '#c95efb', transparent: true, opacity: 0.9 })
    );
    this.beam.visible = false;
    scene.add(this.beam);
    this.beamGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#e9c1ff', transparent: true, opacity: 0.8 })
    );
    this.beamGlow.visible = false;
    scene.add(this.beamGlow);

    // rocket fists
    this.rocketMeshes = [];

    this.prevPos = new V3();
    this.velocity = new V3();
  }

  dispose(scene) {
    scene.remove(this.root, this.beam, this.beamGlow);
    for (const side of ['L', 'R']) {
      const a = this.arms[side];
      scene.remove(a.upper, a.fore, a.elbow, a.fist);
    }
    for (const m of this.rocketMeshes) scene.remove(m);
  }

  apply(ma, mb, alpha, dt) {
    this.root.position.set(
      lerp(ma.p[0], mb.p[0], alpha), lerp(ma.p[1], mb.p[1], alpha), lerp(ma.p[2], mb.p[2], alpha));
    const qa = new THREE.Quaternion(...ma.q), qb = new THREE.Quaternion(...mb.q);
    this.root.quaternion.copy(qa.slerp(qb, alpha));

    if (dt > 0) {
      this.velocity.copy(this.root.position).sub(this.prevPos).divideScalar(Math.max(dt, 1e-4));
      this.prevPos.copy(this.root.position);
    }

    // head turns toward head yaw/pitch (relative to body)
    const bodyYaw = getYaw(this.root.quaternion);
    let rel = (mb.head.yaw ?? 0) - bodyYaw;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    this.head.rotation.y += (clampN(rel, 1.15) - this.head.rotation.y) * 0.25;
    this.head.rotation.x += (clampN(-(mb.head.pitch ?? 0), 0.6) - this.head.rotation.x) * 0.25;

    // eye charge glow
    const charge = mb.laser.charge || 0;
    const chargeScale = 1 + charge * 2.6 + (mb.laser.firing ? 1.4 : 0);
    this.eye.scale.setScalar(chargeScale + (charge > 0 ? Math.random() * 0.3 : 0));
    this.eye.material.color.set(mb.laser.firing ? '#f3d9ff' : charge > 0 ? '#c95efb' : '#7d5f96');

    // bobble antenna physics-lite
    this.bobble.position.x = 0.7 + clampN(-this.velocity.x * 0.01, 0.3);
    this.bobble.position.z = clampN(-this.velocity.z * 0.01, 0.3);

    // legs
    const kick = mb.kick;
    if (mb.ragdoll || mb.dead) {
      this.poseLegRag();
    } else if (kick.phase !== 'idle') {
      this.poseKick(kick);
    } else {
      this.walkPhase += (mb.walk || 0) * dt * 0.62;
      const swing = Math.min(1, (mb.walk || 0) / 3.4) * 0.75;
      for (let i = 0; i < 2; i++) {
        const L = this.legs[i];
        const ph = this.walkPhase + i * Math.PI;
        L.hip.rotation.x = damp(L.hip.rotation.x, Math.sin(ph) * swing, 12, dt);
        L.shinG.rotation.x = damp(L.shinG.rotation.x, Math.max(0, -Math.sin(ph + 0.9)) * swing * 0.9, 12, dt);
      }
    }

    // arms
    for (const side of ['L', 'R']) {
      this.poseArm(side, mb, alpha, dt);
    }

    // laser beam
    if (mb.laser.firing && mb.laser.from && mb.laser.to) {
      const from = new V3(...mb.laser.from), to = new V3(...mb.laser.to);
      placeBeam(this.beam, from, to);
      this.beam.visible = true;
      this.beam.material.opacity = 0.75 + Math.random() * 0.25;
      this.beamGlow.visible = true;
      this.beamGlow.position.copy(to);
      this.beamGlow.scale.setScalar(0.8 + Math.random() * 0.5);
    } else {
      this.beam.visible = false;
      this.beamGlow.visible = false;
    }

    // rocket fists
    const rockets = mb.rockets || [];
    while (this.rocketMeshes.length < rockets.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), this.mats.trim);
      this.scene.add(m);
      this.rocketMeshes.push(m);
    }
    this.rocketMeshes.forEach((m, i) => {
      const r = rockets[i];
      m.visible = !!r;
      if (r) {
        m.position.set(...r.p);
        m.rotation.x += dt * 12;
      }
    });
  }

  poseArm(side, mb, alpha, dt) {
    const arm = this.arms[side];
    const st = mb.arms[side];
    const P = MECH.punch;
    const shoulder = new V3(arm.s * 2.9, 2.3, 0)
      .applyQuaternion(this.root.quaternion).add(this.root.position);

    const aim = new V3(
      -Math.sin(st.yaw) * Math.cos(st.pitch),
      Math.sin(st.pitch),
      -Math.cos(st.yaw) * Math.cos(st.pitch)
    );
    const sideDir = new V3(-aim.z, 0, aim.x).normalize().multiplyScalar(arm.s * 1.4);

    let target;
    if (mb.ragdoll || mb.dead) {
      target = shoulder.clone().add(new V3(arm.s * 2, -1.5, 0.5));
    } else if (st.phase === 'windup') {
      const k = Math.min(1, st.t / P.windup);
      target = shoulder.clone().addScaledVector(aim, -2.2 * k).add(sideDir).add(new V3(0, 0.8 * k, 0));
    } else if (st.phase === 'swing') {
      const k = Math.min(1, st.t / P.swing);
      target = shoulder.clone().addScaledVector(aim, -2.2 + (P.range * 0.92 + 2.2) * ease(k)).add(sideDir.clone().multiplyScalar(1 - k * 0.7));
    } else if (st.phase === 'recover') {
      const k = Math.min(1, st.t / P.recover);
      target = shoulder.clone().addScaledVector(aim, P.range * 0.92 * (1 - ease(k))).add(sideDir);
      target.y -= ease(k) * 2.2;
    } else {
      // idle: fists sway at the sides
      const sway = Math.sin(performance.now() / 700 + arm.s) * 0.25;
      target = shoulder.clone().add(new V3(arm.s * 0.9, -3.4 + sway, -0.4));
    }

    arm.pos.lerp(target, Math.min(1, dt * (st.phase === 'swing' ? 40 : 14)));

    const mid = shoulder.clone().add(arm.pos).multiplyScalar(0.5);
    mid.y -= st.phase === 'idle' ? 0.9 : 0.3;
    placeSegment(arm.upper, shoulder, mid, 1.0);
    placeSegment(arm.fore, mid, arm.pos, 1.0);
    arm.elbow.position.copy(mid);
    arm.fist.position.copy(arm.pos);
    arm.fist.quaternion.copy(this.root.quaternion);
    const fs = (mb.up?.fists ? 1.55 : 1) * (st.phase === 'swing' ? 1.15 : 1);
    arm.fist.scale.setScalar(fs);
  }

  poseKick(kick) {
    const K = MECH.kick;
    const [planted, kicker] = this.legs;
    if (kick.phase === 'windup') {
      const k = Math.min(1, kick.t / K.windup);
      kicker.hip.rotation.x = 0.7 * k;          // leg back
      kicker.shinG.rotation.x = 1.1 * k;
      planted.hip.rotation.x = -0.15 * k;
    } else if (kick.phase === 'swing') {
      const k = Math.min(1, kick.t / K.swing);
      kicker.hip.rotation.x = 0.7 - 2.0 * ease(k); // BOOT
      kicker.shinG.rotation.x = 1.1 - 1.0 * ease(k);
    } else {
      const k = Math.min(1, kick.t / K.recover);
      kicker.hip.rotation.x = -1.3 * (1 - ease(k));
      kicker.shinG.rotation.x = 0.1 * (1 - ease(k));
      planted.hip.rotation.x = -0.15 * (1 - ease(k));
    }
  }

  poseLegRag() {
    const [a, b] = this.legs;
    a.hip.rotation.x = damp(a.hip.rotation.x, 1.9, 6, 1 / 60);
    b.hip.rotation.x = damp(b.hip.rotation.x, -1.4, 6, 1 / 60);
    a.shinG.rotation.x = damp(a.shinG.rotation.x, 0.8, 6, 1 / 60);
    b.shinG.rotation.x = damp(b.shinG.rotation.x, 1.2, 6, 1 / 60);
  }
}

// ===========================================================================
// CRABZILLA — a giant, deeply furious crab.
// ===========================================================================
class CrabView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    const shell = new THREE.MeshLambertMaterial({ color: '#e2543e' });
    const belly = new THREE.MeshLambertMaterial({ color: '#f2a08a' });
    const dark = new THREE.MeshLambertMaterial({ color: '#8f2d1e' });

    const body = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 4.2), shell);
    body.castShadow = true;
    this.root.add(body);
    const under = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 3.4), belly);
    under.position.y = -1.1;
    this.root.add(under);

    // eyestalks with googly eyes
    this.eyes = [];
    for (const s of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.8), dark);
      stalk.position.set(s * 1.1, 2.0, -1.6);
      this.root.add(stalk);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8),
        new THREE.MeshLambertMaterial({ color: '#ffffff' }));
      eye.position.set(s * 1.1, 3.0, -1.6);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      pupil.position.z = -0.42;
      eye.add(pupil);
      this.root.add(eye);
      this.eyes.push({ eye, pupil });
    }
    // angry eyebrows. crucial.
    for (const s of [-1, 1]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.25),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      brow.position.set(s * 1.1, 3.6, -1.7);
      brow.rotation.z = -s * 0.45;
      this.root.add(brow);
    }

    // claws
    this.claws = [];
    for (const s of [-1, 1]) {
      const armG = new THREE.Group();
      armG.position.set(s * 2.9, 0.4, -1.4);
      this.root.add(armG);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 2.2), dark);
      arm.position.z = -1.0;
      armG.add(arm);
      const claw = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 2.3), shell);
      claw.position.z = -2.6;
      claw.castShadow = true;
      armG.add(claw);
      const pincer = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.6), dark);
      pincer.position.set(0, 0.85, -2.9);
      armG.add(pincer);
      this.claws.push(armG);
    }

    // legs: 3 stubs per side
    this.legMeshes = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.9, 0.55), dark);
        leg.position.set(s * 3.0, -1.5, -1.2 + i * 1.3);
        leg.rotation.z = s * 0.5;
        this.root.add(leg);
        this.legMeshes.push(leg);
      }
    }

    this.bar = makeHpBar(scene);
    this.scuttle = Math.random() * 9;
    this.flash = 0;
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.bar.sprite);
  }

  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha);
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    // crabs walk sideways-ish: face 60° off their travel direction (comedy + accuracy)
    this.root.rotation.y = lerpAngle(this.root.rotation.y, (mb.yaw ?? 0) + 0.6, 0.15);

    if (mb.state === 'dead') {
      // flip over, sink
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI, 5, dt);
      this.root.position.y = y - Math.min(2.2, (mb.t || 0) * 1.2);
      this.bar.sprite.visible = false;
      return;
    }
    if (mb.state === 'spawn') {
      const k = Math.min(1, (mb.t || 0) / 1.4);
      this.root.scale.setScalar(0.2 + 0.8 * bounce(k));
    } else {
      this.root.scale.setScalar(1);
    }

    // scuttle those little legs
    this.scuttle += dt * 9;
    this.legMeshes.forEach((leg, i) => {
      leg.rotation.x = Math.sin(this.scuttle + i * 1.1) * (mb.state === 'walk' ? 0.5 : 0.12);
    });

    // claws: raise during telegraph, swipe on attack
    const tele = mb.state === 'telegraph';
    const attacking = mb.state === 'attack';
    this.claws.forEach((c, i) => {
      let want = 0.15 + Math.sin(this.scuttle * 0.5 + i) * 0.1;
      if (tele) want = 1.5 + Math.sin(performance.now() / 60) * 0.12; // shaking with rage
      if (attacking) want = -0.7;
      c.rotation.x = damp(c.rotation.x, want, tele ? 8 : 16, dt);
    });

    // googly rage
    for (const e of this.eyes) {
      e.pupil.position.x = Math.sin(this.scuttle * 1.7) * 0.13;
      e.pupil.position.y = Math.cos(this.scuttle * 1.3) * 0.1;
    }

    this.bar.update(this.root.position, 5.2, mb.hp / mb.maxHp);
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

    const grey = new THREE.MeshLambertMaterial({ color: '#9aa3b2' });
    const lite = new THREE.MeshLambertMaterial({ color: '#c6ccd6' });
    const green = new THREE.MeshLambertMaterial({ color: '#4d8f6b' });

    const body = new THREE.Mesh(new THREE.SphereGeometry(2.9, 10, 8), grey);
    body.scale.set(1, 0.95, 1.25);
    body.castShadow = true;
    body.position.y = 0.4;
    this.root.add(body);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(2.1, 10, 8), lite);
    chest.position.set(0, -0.2, -1.4);
    this.root.add(chest);

    // tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 2.6), grey);
    tail.position.set(0, 0.8, 3.4);
    tail.rotation.x = 0.35;
    this.root.add(tail);

    // wings
    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 3.6), grey);
      wing.geometry.translate(0, -0.9, 0);
      wing.position.set(s * 2.7, 1.6, 0.4);
      wing.rotation.z = s * 0.5;
      wing.castShadow = true;
      this.root.add(wing);
      this.wings.push({ mesh: wing, s });
    }

    // neck + head (the bob is everything)
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.6, -2.2);
    this.root.add(this.neck);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 2.4), green);
    neckMesh.position.y = 1.0;
    this.neck.add(neckMesh);
    this.headG = new THREE.Group();
    this.headG.position.set(0, 2.4, 0);
    this.neck.add(this.headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), grey);
    head.castShadow = true;
    this.headG.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 6),
      new THREE.MeshLambertMaterial({ color: '#f2a65a' }));
    beak.position.set(0, -0.1, -1.6);
    beak.rotation.x = -Math.PI / 2;
    this.headG.add(beak);
    // googly eyes + furious brows
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8),
        new THREE.MeshLambertMaterial({ color: '#ffffff' }));
      eye.position.set(s * 0.75, 0.3, -0.75);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      pupil.position.z = -0.28;
      eye.add(pupil);
      this.headG.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.2),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      brow.position.set(s * 0.75, 0.75, -0.85);
      brow.rotation.z = -s * 0.5;
      this.headG.add(brow);
    }

    // legs
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4),
        new THREE.MeshLambertMaterial({ color: '#d1495b' }));
      leg.position.set(s * 1.1, -2.4, 0);
      this.root.add(leg);
      const footM = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 1.7),
        new THREE.MeshLambertMaterial({ color: '#d1495b' }));
      footM.position.set(s * 1.1, -3.5, -0.3);
      this.root.add(footM);
    }

    this.bar = makeHpBar(scene);
    this.bob = Math.random() * 9;
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.bar.sprite);
  }

  apply(ma, mb, alpha, dt) {
    const y = lerp(ma.p[1], mb.p[1], alpha) + 0.6;
    this.root.position.set(lerp(ma.p[0], mb.p[0], alpha), y, lerp(ma.p[2], mb.p[2], alpha));
    this.root.rotation.y = lerpAngle(this.root.rotation.y, mb.yaw ?? 0, 0.15);

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
      // wings up, shaking — get out of the way
      for (const w of this.wings) {
        w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 2.4 + Math.sin(performance.now() / 50) * 0.15, 10, dt);
      }
    } else if (attacking && mb.kind === 'gust') {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 0.3, 30, dt);
    } else {
      for (const w of this.wings) w.mesh.rotation.z = damp(w.mesh.rotation.z, w.s * 0.5, 8, dt);
    }
    if (tele && mb.kind !== 'gust') {
      this.neck.rotation.x = damp(this.neck.rotation.x, -0.55, 8, dt); // rear back
    } else if (attacking && mb.kind !== 'gust') {
      this.neck.rotation.x = damp(this.neck.rotation.x, 0.75, 30, dt); // PECK
    } else {
      this.neck.rotation.x = damp(this.neck.rotation.x, 0, 8, dt);
    }

    this.bar.update(this.root.position, 7.2, mb.hp / mb.maxHp);
  }
}

// ---------------------------------------------------------------- helpers
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
      ctx.fillStyle = 'rgba(20,22,40,0.85)';
      roundRect(ctx, 0, 0, 128, 18, 9); ctx.fill();
      ctx.fillStyle = frac > 0.5 ? '#6fc2a0' : frac > 0.25 ? '#f5d76e' : '#ef767a';
      roundRect(ctx, 3, 3, Math.max(6, 122 * frac), 12, 6); ctx.fill();
      tex.needsUpdate = true;
    },
  };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeSkyTexture() {
  const cv = document.createElement('canvas');
  cv.width = 2; cv.height = 512;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#5d7ec9');    // high sky
  grad.addColorStop(0.45, '#9b8fd4');
  grad.addColorStop(0.72, '#f2a08a'); // horizon glow
  grad.addColorStop(1, '#f9c46b');    // low warm band
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWindowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 120; y += 14) {
    for (let x = 6; x < 58; x += 12) {
      ctx.fillStyle = Math.random() < 0.22 ? '#ffe9b0' : 'rgba(30,34,60,0.55)';
      ctx.fillRect(x, y, 7, 9);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function placeSegment(mesh, a, b, radiusScale = 1) {
  const dir = b.clone().sub(a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(radiusScale, len, radiusScale);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
}
function placeBeam(mesh, a, b) {
  placeSegment(mesh, a, b, 1);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
function clampN(n, m) { return Math.max(-m, Math.min(m, n)); }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function bounce(t) {
  if (t < 0.6) return (t / 0.6) * 1.15;
  return 1.15 - 0.15 * ((t - 0.6) / 0.4);
}
function damp(cur, target, speed, dt) { return cur + (target - cur) * Math.min(1, speed * dt); }
function getYaw(q) {
  const fwd = new V3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-fwd.x, -fwd.z);
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
