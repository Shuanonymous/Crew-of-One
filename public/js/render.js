import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MECH } from '/shared/constants.js';

// Everything visual. Style goals: stylized-cinematic — chunky low-poly
// geometry under dramatic golden-hour light, painterly gradient skies
// that shift as the run goes on, bloom on anything that glows.

const V3 = THREE.Vector3;

// The run is a journey: sunset -> dusk -> neon night -> dawn, per wave.
const PALETTES = [
  { name: 'nightrain', sky: ['#0a0d1c', '#141833', '#252048', '#3a2a5e'], fog: '#1d1b33',
    hemi: ['#9fb0e0', '#26223f'], sun: '#bcd0ff', sunI: 2.0, sunPos: [-60, 60, -35], amb: 1.35, sunDisc: '#dfe6ff' },
  { name: 'sunset', sky: ['#5d7ec9', '#9b8fd4', '#f2a08a', '#f9c46b'], fog: '#e89a80',
    hemi: ['#ffe8c9', '#6b5d8f'], sun: '#ffc27d', sunI: 2.2, sunPos: [80, 38, 30], amb: 1.0, sunDisc: '#ffd9a0' },
  { name: 'dusk', sky: ['#2c2a5e', '#5d4a8f', '#b0628f', '#e8896b'], fog: '#8f5a7a',
    hemi: ['#d9b8ff', '#3d3660'], sun: '#ff9d76', sunI: 1.5, sunPos: [90, 22, 60], amb: 0.8, sunDisc: '#ffb08a' },
  { name: 'neon', sky: ['#0d0d26', '#1d1b45', '#31255e', '#4a2a66'], fog: '#2a2050',
    hemi: ['#7d9df0', '#1d1433'], sun: '#8aa5ff', sunI: 0.8, sunPos: [-60, 55, -40], amb: 0.65, sunDisc: '#e8ecff' },
  { name: 'dawn', sky: ['#3d6a9e', '#7fa3c9', '#f2c4a0', '#ffe9b8'], fog: '#d9b8a0',
    hemi: ['#fff2d9', '#5d6a8f'], sun: '#fff0c9', sunI: 1.9, sunPos: [-80, 30, 40], amb: 1.05, sunDisc: '#fff6dd' },
];

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2; this.skyCanvas.height = 512;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog('#e89a80', 90, 320);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 900);
    this.camDist = 30;
    this.trauma = 0;
    this.camPos = new V3(0, 20, 40);

    this.hemi = new THREE.HemisphereLight('#ffe8c9', '#6b5d8f', 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffc27d', 2.2);
    this.sun.position.set(80, 38, 30); // low sun = long dramatic shadows
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const S = 95;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.far = 400;
    this.scene.add(this.sun);
    // cool rim light from behind so the mech pops off the sky
    this.rim = new THREE.DirectionalLight('#8aa5ff', 1.25);
    this.rim.position.set(-50, 35, -60);
    this.scene.add(this.rim);
    // warm fill from the opposite side — cinematic two-tone key/rim so the
    // hull never flattens into a silhouette (cool moon vs warm sodium glow)
    this.fill = new THREE.DirectionalLight('#ffb87a', 0.55);
    this.fill.position.set(55, 26, 45);
    this.scene.add(this.fill);

    // giant low sun/moon disc (blooms nicely)
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(60, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd9a0', fog: false })
    );
    this.sunDisc.position.set(400, 60, 150);
    this.sunDisc.lookAt(0, 0, 0);
    this.scene.add(this.sunDisc);

    // silhouetted skyline rings — the city goes on forever
    const silGeos = [];
    const rng0 = mulberry32(3);
    for (let ring = 0; ring < 2; ring++) {
      const r = 200 + ring * 90;
      for (let i = 0; i < 42; i++) {
        const a = (i / 42) * Math.PI * 2 + ring * 0.07;
        const h = 25 + rng0() * (55 + ring * 40);
        const w = 18 + rng0() * 26;
        const gBox = new THREE.BoxGeometry(w, h, w);
        gBox.translate(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
        silGeos.push(gBox);
      }
    }
    this.silhouettes = new THREE.Mesh(mergeGeometries(silGeos),
      new THREE.MeshBasicMaterial({ color: '#241f42', fog: false }));
    this.silhouettes.frustumCulled = false;
    this.scene.add(this.silhouettes);

    // drifting embers / dust motes: one Points cloud
    const emberN = 70;
    this.emberPos = new Float32Array(emberN * 3);
    for (let i = 0; i < emberN; i++) {
      this.emberPos[i * 3] = (Math.random() - 0.5) * 130;
      this.emberPos[i * 3 + 1] = Math.random() * 30 + 1;
      this.emberPos[i * 3 + 2] = (Math.random() - 0.5) * 130;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.emberPts = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: '#ffcf8a', size: 0.5, transparent: true, opacity: 0.6 }));
    this.emberPts.frustumCulled = false;
    this.scene.add(this.emberPts);
    this.embers = []; // legacy handle for setQuality

    // RAIN: one Points cloud (1 draw call), positions updated per frame
    const rainN = 600;
    this.rainPos = new Float32Array(rainN * 3);
    for (let i = 0; i < rainN; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 150;
      this.rainPos[i * 3 + 1] = Math.random() * 60;
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 150;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainPts = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#8fa3cc', size: 0.5, transparent: true, opacity: 0.55, sizeAttenuation: true }));
    this.rainPts.frustumCulled = false;
    this.scene.add(this.rainPts);
    // SEARCHLIGHTS: sweeping cones over the district
    this.searchlights = [];
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(14, 130, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: '#aebfff', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      cone.geometry.translate(0, 65, 0);
      cone.rotation.x = Math.PI;
      cone.position.set((i - 1) * 90, 130, -60 + i * 60);
      this.scene.add(cone);
      this.searchlights.push({ cone, ph: i * 2.1 });
    }
    this.lightningT = 4 + Math.random() * 8;
    this.flash = 0;

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.mechViews = new Map();
    this.monsterViews = new Map();
    this.crateMeshes = [];
    this.propMeshes = new Map();   // cars
    this.projMeshes = new Map();   // spitter globs
    this.ringViews = [];
    this.balloonView = null;
    this.particles = [];
    this.effects = [];             // shockwave rings, scorch marks
    this.windowTex = makeWindowTexture();

    // palette state (lerped on wave changes)
    this.palA = PALETTES[0]; this.palB = PALETTES[0]; this.palT = 1;
    this.applyPalette(this.palA, this.palA, 1);

    // bloom pipeline: only genuinely bright things glow
    // procedural environment map so PBR metal reflects the night sky/city glow
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color('#141833');
      const glow = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#3a4a7a', side: THREE.BackSide }));
      envScene.add(glow);
      const neon = new THREE.PointLight('#4dfff0', 40, 200); neon.position.set(20, 10, 20); envScene.add(neon);
      const neon2 = new THREE.PointLight('#ff5da2', 40, 200); neon2.position.set(-25, 8, -15); envScene.add(neon2);
      this.scene.environment = pmrem.fromScene(envScene).texture;
    } catch (e) { /* PMREM unsupported: metal falls back to lit-only */ }

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    const opts = {
      low: { pr: 0.75, shadows: false, bloom: 0, fog: 190, embers: 0 },
      medium: { pr: 1, shadows: true, bloom: 0.55, fog: 320, embers: 40 },
      high: { pr: Math.min(window.devicePixelRatio, 2), shadows: true, bloom: 0.7, fog: 420, embers: 70 },
    }[q] || {};
    if (!opts.pr) return;
    this.renderer.setPixelRatio(opts.pr);
    this.renderer.shadowMap.enabled = opts.shadows;
    this.sun.castShadow = opts.shadows;
    if (this.bloom) this.bloom.strength = opts.bloom;
    this.scene.fog.far = opts.fog;
    this.emberPts.visible = opts.embers > 0;
    this.rainPts.material.size = opts.pr < 1 ? 0.7 : 0.5;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  shake(amount) {
    // global budget: single hits clamp at 0.9, total never exceeds 1.2
    const a = Math.min(0.9, amount) * (this.shakeMult ?? 1);
    this.trauma = Math.min(1.2, this.trauma + a);
  }

  // ------------------------------------------------ palettes / atmosphere
  setPalette(i) {
    this.palA = this.currentPalette();
    this.palB = PALETTES[((i % PALETTES.length) + PALETTES.length) % PALETTES.length];
    this.palT = 0;
  }

  currentPalette() {
    // sample the in-flight blend so transitions can restart smoothly
    const t = this.palT, a = this.palA, b = this.palB;
    const mix = (x, y) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
    return {
      sky: a.sky.map((c, i) => mix(c, b.sky[i])),
      fog: mix(a.fog, b.fog),
      hemi: [mix(a.hemi[0], b.hemi[0]), mix(a.hemi[1], b.hemi[1])],
      sun: mix(a.sun, b.sun),
      sunI: a.sunI + (b.sunI - a.sunI) * t,
      sunPos: a.sunPos.map((v, i) => v + (b.sunPos[i] - v) * t),
      amb: a.amb + (b.amb - a.amb) * t,
      sunDisc: mix(a.sunDisc, b.sunDisc),
    };
  }

  applyPalette(pal) {
    const ctx = this.skyCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, pal.sky[0]);
    grad.addColorStop(0.45, pal.sky[1]);
    grad.addColorStop(0.72, pal.sky[2]);
    grad.addColorStop(1, pal.sky[3]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);
    this.skyTex.needsUpdate = true;
    this.scene.fog.color.set(pal.fog);
    this.hemi.color.set(pal.hemi[0]);
    this.hemi.groundColor.set(pal.hemi[1]);
    this.hemi.intensity = pal.amb;
    this.sun.color.set(pal.sun);
    this.sun.intensity = pal.sunI;
    this.sun.position.set(...pal.sunPos);
    this.sunDisc.material.color.set(pal.sunDisc);
    this.sunDisc.position.set(pal.sunPos[0] * 5, Math.max(35, pal.sunPos[1] * 2.2), pal.sunPos[2] * 5);
    this.sunDisc.lookAt(0, 40, 0);
  }

  stepAtmosphere(dt) {
    if (this.palT < 1) {
      this.palT = Math.min(1, this.palT + dt / 3.5);
      this.applyPalette(this.currentPalette());
    }
    const t = performance.now() / 1000;
    // rain falls around the camera (single buffer update)
    const rp = this.rainPos;
    for (let i = 0; i < rp.length; i += 3) {
      rp[i + 1] -= dt * 46;
      if (rp[i + 1] < 0) {
        rp[i] = this.camPos.x + (Math.random() - 0.5) * 150;
        rp[i + 1] = 55 + Math.random() * 10;
        rp[i + 2] = this.camPos.z + (Math.random() - 0.5) * 150;
      }
    }
    this.rainPts.geometry.attributes.position.needsUpdate = true;
    // searchlights sweep slowly
    for (const s of this.searchlights) {
      s.cone.rotation.z = Math.sin(t * 0.21 + s.ph) * 0.5;
      s.cone.rotation.x = Math.PI + Math.cos(t * 0.17 + s.ph) * 0.35;
    }
    // horizon lightning: a sudden hemi flash, then decay
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightningT = 6 + Math.random() * 14;
      this.flash = 1;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      this.hemi.intensity = (this.palB.amb ?? 0.6) + this.flash * 1.6;
    }
    const ep = this.emberPos;
    for (let i = 0; i < ep.length; i += 3) {
      ep[i + 1] += dt * 0.7;
      if (ep[i + 1] > 32) ep[i + 1] = 0.5;
    }
    this.emberPts.geometry.attributes.position.needsUpdate = true;
    this.emberPts.material.opacity = 0.35 + 0.25 * Math.sin(t * 2);
  }

  // ------------------------------------------------------- effect spawns
  ring(pos, color = '#ffd9a0', maxR = 14, dur = 0.55) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.35, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos[0], Math.max(0.25, pos[1] - 6), pos[2]);
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur, maxR, kind: 'ring' });
  }

  // drifting smoke puff (rocket trails, explosions)
  smoke(pos) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.7 + Math.random() * 0.5, 6, 5),
      new THREE.MeshBasicMaterial({ color: '#6b6b78', transparent: true, opacity: 0.5 })
    );
    m.position.set(pos[0] + (Math.random() - 0.5), pos[1], pos[2] + (Math.random() - 0.5));
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 1.1, kind: 'smoke', rise: 3 + Math.random() * 2 });
    const smokes = this.effects.filter((e) => e.kind === 'smoke');
    if (smokes.length > 60) { smokes[0].t = smokes[0].dur; }
  }

  // bright muzzle flash at a world point (gunfire / rocket launch)
  muzzle(pos, color = '#fff2c0', size = 2.4) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    m.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 0.12, kind: 'muzzle' });
  }

  scorch(pos, r = 3.2) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r, 20),
      new THREE.MeshBasicMaterial({ color: '#14101f', transparent: true, opacity: 0.75 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos[0], 0.08 + Math.random() * 0.03, pos[2]);
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 11, kind: 'scorch' });
    // keep the pool bounded
    const scorches = this.effects.filter((e) => e.kind === 'scorch');
    if (scorches.length > 26) { const old = scorches[0]; old.t = old.dur; }
  }

  stepEffects(dt) {
    for (const e of this.effects) {
      e.t += dt;
      const k = e.t / e.dur;
      if (e.kind === 'ring') {
        const s = 1 + (e.maxR - 1) * easeOut(Math.min(1, k));
        e.m.scale.set(s, s, 1);
        e.m.material.opacity = 0.95 * (1 - k);
      } else if (e.kind === 'scorch') {
        e.m.material.opacity = 0.75 * (1 - Math.max(0, k - 0.7) / 0.3);
      } else if (e.kind === 'smoke') {
        e.m.position.y += e.rise * dt;
        e.m.scale.setScalar(1 + k * 1.8);
        e.m.material.opacity = 0.5 * (1 - k);
      } else if (e.kind === 'muzzle') {
        e.m.scale.setScalar(1 + k * 1.5);
        e.m.material.opacity = 0.95 * (1 - k);
      }
      if (e.t >= e.dur) this.scene.remove(e.m);
    }
    this.effects = this.effects.filter((e) => e.t < e.dur);
  }

  worldToScreen(p) {
    const v = new V3(p[0], p[1], p[2]).project(this.camera);
    if (v.z > 1) return null; // behind the camera
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  // ------------------------------------------------------------ world
  clearWorld() {
    this.scene.remove(this.worldGroup);
    // RAIN: one Points cloud (1 draw call), positions updated per frame
    const rainN = 600;
    this.rainPos = new Float32Array(rainN * 3);
    for (let i = 0; i < rainN; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 150;
      this.rainPos[i * 3 + 1] = Math.random() * 60;
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 150;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainPts = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#8fa3cc', size: 0.5, transparent: true, opacity: 0.55, sizeAttenuation: true }));
    this.rainPts.frustumCulled = false;
    this.scene.add(this.rainPts);
    // SEARCHLIGHTS: sweeping cones over the district
    this.searchlights = [];
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(14, 130, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: '#aebfff', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      cone.geometry.translate(0, 65, 0);
      cone.rotation.x = Math.PI;
      cone.position.set((i - 1) * 90, 130, -60 + i * 60);
      this.scene.add(cone);
      this.searchlights.push({ cone, ph: i * 2.1 });
    }
    this.lightningT = 4 + Math.random() * 8;
    this.flash = 0;

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
    this.batches = { body: {}, roof: {} }; // color -> geometry list

    for (const d of world.city) {
      if (d.kind === 'ground') {
        // rain-slicked asphalt: dark, semi-metallic, low roughness so it
        // mirrors the neon sky/city through the env map (cinematic wet look)
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(...d.size),
          new THREE.MeshStandardMaterial({ color: '#0e1220', metalness: 0.85, roughness: 0.28, envMapIntensity: 1.2 })
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
      } else if (d.kind === 'river') {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(d.size[0], d.size[1]),
          new THREE.MeshBasicMaterial({ color: '#0a1428', transparent: true, opacity: 0.92 })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(d.p[0], d.p[1], d.p[2]);
        g.add(mesh);
      } else if (d.kind === 'landmark') {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...d.size),
          new THREE.MeshLambertMaterial({ color: d.color, map: this.windowTex }));
        mesh.position.set(...d.p);
        mesh.castShadow = true;
        g.add(mesh);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6),
          new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
        cap.position.set(d.p[0], d.p[1] + d.size[1] / 2 + 2, d.p[2]);
        g.add(cap);
      } else if (d.kind === 'building') {
        // batch: one merged mesh per color = a handful of draw calls total
        const box = new THREE.BoxGeometry(...d.size);
        if (d.yaw) box.rotateY(d.yaw);
        box.translate(...d.p);
        (this.batches.body[d.color] = this.batches.body[d.color] || []).push(box);
        const roof = new THREE.BoxGeometry(d.size[0] + 0.7, 0.8, d.size[2] + 0.7);
        if (d.yaw) roof.rotateY(d.yaw);
        roof.translate(d.p[0], d.p[1] + d.size[1] / 2 + 0.4, d.p[2]);
        (this.batches.roof[d.color] = this.batches.roof[d.color] || []).push(roof);
        this.decorateBuilding(g, d);
      }
    }
    for (const [color, geos] of Object.entries(this.batches.body)) {
      const mesh = new THREE.Mesh(mergeGeometries(geos),
        new THREE.MeshLambertMaterial({ color, map: this.windowTex }));
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    }
    for (const [color, geos] of Object.entries(this.batches.roof)) {
      const mesh = new THREE.Mesh(mergeGeometries(geos),
        new THREE.MeshLambertMaterial({ color: shade(color, 0.72) }));
      g.add(mesh);
    }

    // ---- war damage: a kaiju has been through here. Broken rooflines,
    // rubble mounds, exposed rebar, scattered debris. All merged into a
    // few meshes so the destruction costs almost nothing to draw. ----
    this.buildDamage(g, world);

    // endless-run interactables
    this.beaconViews = [];
    for (const b of []) { // beacons removed — endless buys anywhere
      const grp = new THREE.Group();
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 9, 8),
        new THREE.MeshLambertMaterial({ color: '#2a3145' }));
      pylon.position.y = 4.5;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#4dfff0' }));
      lamp.position.y = 10;
      const ring = new THREE.Mesh(new THREE.RingGeometry(7.6, 9, 40),
        new THREE.MeshBasicMaterial({ color: '#4dfff0', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      grp.add(pylon, lamp, ring);
      grp.position.set(b.p[0], 0, b.p[2]);
      g.add(grp);
      this.beaconViews.push({ grp, lamp, ring });
    }
    this.tankViews = [];
    for (const t of world.tanks || []) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 4.5, 10),
        new THREE.MeshLambertMaterial({ color: '#b8622e' }));
      m.position.set(t.p[0], 2.2, t.p[2]);
      m.castShadow = true;
      g.add(m);
      this.tankViews.push(m);
    }
    this.stationViews = [];
    for (const s of world.stations || []) {
      const grp = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.5, 20),
        new THREE.MeshLambertMaterial({ color: '#1d3a4a' }));
      pad.position.y = 0.25;
      const glow = new THREE.Mesh(new THREE.RingGeometry(7.5, 8.6, 30),
        new THREE.MeshBasicMaterial({ color: '#5cff8f', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.6;
      grp.add(pad, glow);
      grp.position.set(s.p[0], 0, s.p[2]);
      g.add(grp);
      this.stationViews.push(grp);
    }
    this.cacheViews = [];
    for (const c of world.caches || []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3),
        new THREE.MeshLambertMaterial({ color: '#8f7a2e' }));
      m.position.set(c.p[0], 1.5, c.p[2]);
      m.rotation.y = 0.5;
      m.castShadow = true;
      g.add(m);
      this.cacheViews.push(m);
    }
    this.pickupMeshes = new Map();

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

    // dynamic props from the server (puntable cars)
    this.propMeshes.clear();
    for (const d of world.props || []) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(d.size[0], d.size[1] * 0.6, d.size[2]),
        new THREE.MeshLambertMaterial({ color: d.color })
      );
      body.castShadow = true;
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(d.size[0] * 0.55, d.size[1] * 0.5, d.size[2] * 0.85),
        new THREE.MeshLambertMaterial({ color: '#1d2033' })
      );
      cabin.position.y = d.size[1] * 0.5;
      car.add(body, cabin);
      g.add(car);
      this.propMeshes.set(d.id, car);
    }
  }

  // Battle-damage the district: broken tops, rubble, rebar, debris fields.
  // Deterministic per building position so every client sees the same ruin.
  buildDamage(g, world) {
    const concrete = [];   // grey chunks (rubble, broken slabs)
    const rebarGeos = [];  // thin rusty bars poking out of the wreckage
    const emberChunks = []; // still-glowing hot debris
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
      // ~55% of buildings are visibly wrecked
      if (h % 100 < 55) {
        // broken, jagged roofline: uneven concrete teeth around the top edge
        const teeth = 3 + (h % 4);
        for (let i = 0; i < teeth; i++) {
          const tw = w * (0.18 + rng() * 0.22);
          const th = 1.5 + rng() * (bh * 0.14);
          const ex = (rng() - 0.5) * (w - tw);
          const ez = (rng() - 0.5) * (dp - tw);
          pushBox(concrete, tw, th, tw, d.p[0] + ex, topY + th / 2 - 0.4, d.p[2] + ez, 0, rng() * 0.6, (rng() - 0.5) * 0.25);
          if (rng() < 0.5) pushBox(rebarGeos, 0.08, th * 1.5, 0.08, d.p[0] + ex, topY + th * 0.9, d.p[2] + ez, (rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4);
        }
        // gouged blast scar partway up the facade (a dark recessed chunk)
        if (h % 3 === 0 && bh > 16) {
          const sy = d.p[1] + (rng() - 0.3) * bh * 0.4;
          pushBox(concrete, w * 0.3, bh * 0.16, 1.2, d.p[0] + (rng() - 0.5) * w * 0.4, sy, d.p[2] + dp / 2, 0, 0, (rng() - 0.5) * 0.3);
        }
      }
      // rubble mound at the base for most buildings
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
    // scattered debris field across open ground (deterministic global seed)
    const grng = mulberry32(90210);
    for (let i = 0; i < 60; i++) {
      const x = (grng() - 0.5) * 300;
      const z = (grng() - 0.5) * 300;
      if (Math.hypot(x, z) < 22) continue; // keep spawn plaza clearer
      const cw = 0.8 + grng() * 2.2;
      const ch = 0.5 + grng() * 1.2;
      pushBox(concrete, cw, ch, cw, x, ch / 2, z, (grng() - 0.5) * 0.4, grng() * Math.PI, (grng() - 0.5) * 0.4);
    }
    const cMat = new THREE.MeshStandardMaterial({ color: '#4a4854', metalness: 0.1, roughness: 0.95, flatShading: true });
    if (concrete.length) {
      const m = new THREE.Mesh(mergeGeometries(concrete), cMat);
      m.castShadow = m.receiveShadow = true; g.add(m);
    }
    if (rebarGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(rebarGeos),
        new THREE.MeshStandardMaterial({ color: '#6e4a34', metalness: 0.8, roughness: 0.6 }));
      g.add(m);
    }
    if (emberChunks.length) {
      const m = new THREE.Mesh(mergeGeometries(emberChunks),
        new THREE.MeshStandardMaterial({ color: '#2a0f04', emissive: new THREE.Color('#ff5a1e'), emissiveIntensity: 1.4, roughness: 0.9 }));
      g.add(m);
      this.emberDebris = m;
    }
  }

  // client-side rooftop garnish: water towers, AC units, antennas, neon
  decorateBuilding(g, d) {
    const h = hashStr(d.p[0] + ',' + d.p[2]);
    const topY = d.p[1] + d.size[1] / 2;
    if (h % 5 === 0) {
      // water tower
      const tw = new THREE.Group();
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 3, 9),
        new THREE.MeshLambertMaterial({ color: '#7a5a48' }));
      tank.position.y = 2.6;
      const lid = new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 9),
        new THREE.MeshLambertMaterial({ color: '#5d4438' }));
      lid.position.y = 4.7;
      tw.add(tank, lid);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4),
          new THREE.MeshLambertMaterial({ color: '#3d3244' }));
        const a = (i / 3) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 1.2, 1.2, Math.sin(a) * 1.2);
        tw.add(leg);
      }
      tw.position.set(d.p[0], topY, d.p[2]);
      g.add(tw);
    } else if (false) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 2.2),
        new THREE.MeshLambertMaterial({ color: shade(d.color, 0.5) }));
      ac.position.set(d.p[0] + 1, topY + 0.65, d.p[2] - 1);
      g.add(ac);
    } else if (false) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 5),
        new THREE.MeshLambertMaterial({ color: '#2b2d42' }));
      ant.position.set(d.p[0], topY + 2.5, d.p[2]);
      g.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 6),
        new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
      tip.position.set(d.p[0], topY + 5.1, d.p[2]);
      g.add(tip);
    }
    if (h % 3 === 0 && d.size[1] > 14) {
      // neon strip partway up a facade — blooms at night
      const neon = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(6, d.size[0] * 0.6), 1.1, 0.25),
        new THREE.MeshBasicMaterial({ color: ['#ff5da2', '#4dfff0', '#ffe14d', '#8aff6b'][h % 4] })
      );
      neon.position.set(d.p[0], d.p[1] + d.size[1] * 0.18, d.p[2] + d.size[2] / 2 + 0.2);
      neon.rotation.y = d.yaw || 0;
      g.add(neon);
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
        view = makeMonsterView(this.scene, mb.type);
        this.monsterViews.set(mb.id, view);
      }
      view.apply(ma, mb, alpha, dt);
    }
    for (const [id, view] of this.monsterViews) {
      if (!seen.has(id)) { view.dispose(this.scene); this.monsterViews.delete(id); }
    }

    // cars
    for (const pb of b.props || []) {
      const mesh = this.propMeshes.get(pb.id);
      if (!mesh) continue;
      const pa = (a.props || []).find((p) => p.id === pb.id) || pb;
      mesh.position.set(lerp(pa.p[0], pb.p[0], alpha), lerp(pa.p[1], pb.p[1], alpha), lerp(pa.p[2], pb.p[2], alpha));
      const qa = new THREE.Quaternion(...pa.q), qb = new THREE.Quaternion(...pb.q);
      mesh.quaternion.copy(qa.slerp(qb, alpha));
    }

    // mech tracers + missiles (ranged weapons) — pooled scene meshes
    this._weaponPool = this._weaponPool || { tracers: [], missiles: [] };
    this._trPrev = this._trPrev || new Map(); // last position per tracer, for streak orientation
    let ti = 0, mi = 0;
    for (const mb of b.mechs) {
      for (const tr of mb.tracers || []) {
        let mesh = this._weaponPool.tracers[ti];
        if (!mesh) {
          // elongated glowing round — reads as a tracer streak, not a ball
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6),
            new THREE.MeshBasicMaterial({ color: '#fff2c0' }));
          this.scene.add(mesh); this._weaponPool.tracers[ti] = mesh;
        }
        mesh.visible = true;
        const cur = new V3(tr.p[0], tr.p[1], tr.p[2]);
        const prev = this._trPrev.get(ti);
        if (prev) mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), cur.clone().sub(prev).normalize());
        this._trPrev.set(ti, cur.clone());
        mesh.position.copy(cur);
        ti++;
      }
      for (const ms of mb.missiles || []) {
        let mesh = this._weaponPool.missiles[mi];
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 8),
            new THREE.MeshStandardMaterial({ color: '#e8503a', emissive: new THREE.Color('#ff6a3a'), emissiveIntensity: 2, metalness: 0.4, roughness: 0.5 }));
          this.scene.add(mesh); this._weaponPool.missiles[mi] = mesh;
        }
        mesh.visible = true; mesh.position.set(ms.p[0], ms.p[1], ms.p[2]); mesh.rotation.x += dt * 8;
        // smoke trail: drop a fading puff behind the rocket
        if (Math.random() < 0.7) this.smoke(ms.p);
        mi++;
      }
    }
    for (let i = ti; i < this._weaponPool.tracers.length; i++) this._weaponPool.tracers[i].visible = false;
    for (let i = mi; i < this._weaponPool.missiles.length; i++) this._weaponPool.missiles[i].visible = false;

    // spitter globs
    const seenPj = new Set();
    for (const pj of b.projs || []) {
      seenPj.add(pj.id);
      let m = this.projMeshes.get(pj.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1),
          new THREE.MeshBasicMaterial({ color: '#9dff5c' }));
        this.scene.add(m);
        this.projMeshes.set(pj.id, m);
      }
      const pa = (a.projs || []).find((p) => p.id === pj.id) || pj;
      m.position.set(lerp(pa.p[0], pj.p[0], alpha), lerp(pa.p[1], pj.p[1], alpha), lerp(pa.p[2], pj.p[2], alpha));
      m.scale.setScalar(0.9 + Math.sin(performance.now() / 60) * 0.15);
    }
    for (const [id, m] of this.projMeshes) {
      if (!seenPj.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
    }

    // credit pickups: glowing chips
    const seenPk = new Set();
    for (const pk of b.pickups || []) {
      seenPk.add(pk.id);
      let m = this.pickupMeshes.get(pk.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.OctahedronGeometry(0.9),
          new THREE.MeshBasicMaterial({ color: '#ffd166' }));
        this.scene.add(m);
        this.pickupMeshes.set(pk.id, m);
      }
      m.position.set(pk.p[0], 1.4 + Math.sin(performance.now() / 300) * 0.4, pk.p[2]);
      m.rotation.y += dt * 3;
    }
    for (const [id, m] of this.pickupMeshes) {
      if (!seenPk.has(id)) { this.scene.remove(m); this.pickupMeshes.delete(id); }
    }
    // interactable liveness
    if (b.inter) {
      b.inter.tanks?.forEach((alive, i) => { if (this.tankViews[i]) this.tankViews[i].visible = alive; });
      b.inter.caches?.forEach((alive, i) => { if (this.cacheViews[i]) this.cacheViews[i].visible = alive; });
      b.inter.stations?.forEach((st, i) => { if (this.stationViews[i]) this.stationViews[i].visible = st.alive; });
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
    CAMERA_Q.copy(this.camera.quaternion);

    this.stepAtmosphere(dt);
    this.stepEffects(dt);
  }

  flashMonster(id) {
    this.monsterViews.get(id)?.flash?.();
  }

  render() { this.composer.render(); }
}

const VIEW_STYLES = {
  crab: { cls: 'crab', scale: 1, shell: '#e2543e', belly: '#f2a08a', dark: '#8f2d1e', scuttleRate: 9 },
  rusher: { cls: 'crab', scale: 0.55, shell: '#4dc9b0', belly: '#9de8d8', dark: '#1f7a68', scuttleRate: 20 },
  tank: { cls: 'crab', scale: 1.75, shell: '#5c6270', belly: '#8a8f9e', dark: '#31353f', scuttleRate: 4, armored: true },
  boss: { cls: 'crab', scale: 2.6, shell: '#b03052', belly: '#e08a8a', dark: '#5c1a30', scuttleRate: 5, crown: true },
  spitter: { cls: 'spitter' },
  flyer: { cls: 'flyer' },
  swarmling: { cls: 'swarm' },
  pigeon: { cls: 'pigeon' },
};
function makeMonsterView(scene, type) {
  const st = VIEW_STYLES[type] || VIEW_STYLES.crab;
  if (st.cls === 'pigeon') return new PigeonView(scene);
  if (st.cls === 'spitter') return new SpitterView(scene);
  if (st.cls === 'flyer') return new FlyerView(scene);
  if (st.cls === 'swarm') return new SwarmView(scene);
  return new CrabView(scene, st);
}

// ===========================================================================
// MECH — chunky, boxy, heavy. Reads from snapshot state; animates locally.
// ===========================================================================
class MechView {
  constructor(scene, color = '#f5b13d') {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    // ---- authored PBR materials: painted gunmetal hull, dark joints,
    // chromed pistons, glowing reactor accents ----
    const hull = new THREE.Color(color).multiplyScalar(0.92); // painted gunmetal
    const main = new THREE.MeshStandardMaterial({ color: hull, metalness: 0.75, roughness: 0.42, envMapIntensity: 1.1 });
    const plate = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), metalness: 0.85, roughness: 0.34, envMapIntensity: 1.2 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2f3d', metalness: 0.9, roughness: 0.3, envMapIntensity: 1.1 });
    const piston = new THREE.MeshStandardMaterial({ color: '#d6dae4', metalness: 1.0, roughness: 0.14, envMapIntensity: 1.4 });
    const trim = new THREE.MeshStandardMaterial({ color: '#0a0d18', metalness: 0.5, roughness: 0.3, emissive: new THREE.Color('#3fe6ff'), emissiveIntensity: 3.2 });
    const hazard = new THREE.MeshStandardMaterial({ color: '#1a1206', metalness: 0.6, roughness: 0.5, emissive: new THREE.Color('#ff8a1e'), emissiveIntensity: 1.8 });
    this.mats = { main, dark, trim };

    // helper: add a mesh at (x,y,z) with optional rotation + shadow
    const P = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    };
    const bevel = (w, h, d) => new THREE.BoxGeometry(w, h, d); // (kept simple for perf)

    // ================= TORSO =================
    // tapered core (wider shoulders, narrow waist) built from stacked plates
    P(this.root, new THREE.CylinderGeometry(2.5, 1.9, 3.4, 8), main, 0, 0.9, 0);   // upper chest drum
    P(this.root, bevel(3.0, 1.6, 2.2), plate, 0, 1.6, -0.2);                        // chest plate
    P(this.root, bevel(1.8, 1.9, 1.8), dark, 0, -1.8, 0);                           // waist block
    P(this.root, bevel(2.6, 0.5, 2.2), plate, 0, -0.9, 0);                          // belt
    // angled pectoral plates
    for (const s of [-1, 1]) P(this.root, bevel(1.3, 1.5, 0.5), plate, s * 0.85, 1.5, -1.15, 0.2, 0, -s * 0.25);
    // glowing reactor core in the chest
    P(this.root, new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), trim, 0, 0.9, -1.35, Math.PI / 2, 0, 0);
    // back thruster pods
    for (const s of [-1, 1]) {
      P(this.root, new THREE.CylinderGeometry(0.5, 0.62, 2.2, 8), dark, s * 1.1, 1.2, 1.4);
      P(this.root, new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8), hazard, s * 1.1, 0.1, 1.5);
    }
    // side exhaust vents
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++)
      P(this.root, bevel(0.3, 0.16, 1.4), hazard, s * 1.65, 0.5 - i * 0.45, -0.3);

    // ================= SHOULDERS (layered pauldrons) =================
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 2.75, 2.15, 0);
      this.root.add(sh);
      P(sh, bevel(2.1, 1.7, 2.6), plate, 0, 0, 0);                 // main pauldron
      P(sh, bevel(2.3, 0.6, 2.8), dark, 0, 0.85, 0);               // top ridge
      P(sh, bevel(0.5, 1.3, 2.2), main, s * 1.0, -0.1, 0, 0, 0, -s * 0.3); // outer flare
      P(sh, new THREE.CylinderGeometry(0.18, 0.18, 2.4, 6), piston, 0, -0.2, 0, Math.PI / 2, 0, 0); // rivet bar
      P(sh, bevel(0.4, 0.4, 0.4), trim, 0, 0.4, -1.4);             // marker light
    }

    // ================= HEAD (angular, T-visor) =================
    this.head = new THREE.Group();
    this.head.position.set(0, 3.35, -0.1);
    this.root.add(this.head);
    P(this.head, new THREE.CylinderGeometry(0.95, 1.15, 1.5, 6), main, 0, 0, 0);   // faceted skull
    P(this.head, bevel(1.9, 0.7, 0.4), dark, 0, 0.1, -0.85);                        // brow
    P(this.head, bevel(0.9, 0.55, 0.4), plate, 0, -0.55, -0.7);                     // chin guard
    // side "ear" comms blocks
    for (const s of [-1, 1]) P(this.head, bevel(0.35, 0.7, 0.7), dark, s * 1.0, 0, 0.1);
    // the eye: a horizontal T-visor slit (emissive; charges up)
    this.eye = new THREE.Mesh(bevel(1.35, 0.32, 0.18), new THREE.MeshBasicMaterial({ color: '#7fe9ff' }));
    this.eye.position.set(0, -0.05, -0.92);
    this.head.add(this.eye);
    // swept crest fin
    P(this.head, bevel(0.16, 0.9, 1.1), plate, 0, 0.7, 0.2, -0.5, 0, 0);
    // blinking sensor light (kept as the ragdoll/charge indicator)
    this.blinker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
    this.blinker.position.set(0.62, 0.55, 0.2);
    this.head.add(this.blinker);

    // ================= LEGS (digitigrade, actuated) =================
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 1.2, -2.6, 0);
      this.root.add(hip);
      P(hip, new THREE.SphereGeometry(0.7, 10, 8), dark, 0, 0, 0);                 // hip ball
      P(hip, new THREE.CylinderGeometry(0.9, 0.75, 2.4, 6), main, 0, -1.3, 0);     // thigh armor
      P(hip, bevel(0.5, 1.8, 0.5), plate, side * 0.7, -1.3, 0.1);                  // thigh side plate
      P(hip, new THREE.CylinderGeometry(0.12, 0.12, 2.0, 6), piston, side * 0.35, -1.3, 0.55); // hydraulic rod

      const shinG = new THREE.Group();
      shinG.position.y = -2.6;
      hip.add(shinG);
      P(shinG, new THREE.SphereGeometry(0.5, 8, 8), piston, 0, 0.1, 0);            // knee actuator
      P(shinG, bevel(0.3, 0.9, 0.3), piston, 0, 0.55, 0.4);                        // knee piston
      P(shinG, new THREE.CylinderGeometry(0.7, 0.55, 2.2, 6), main, 0, -1.1, 0);   // shin
      P(shinG, bevel(1.0, 1.4, 0.4), plate, 0, -1.0, -0.55);                       // shin guard
      // splayed foot with toe plates + heel
      P(shinG, bevel(1.5, 0.5, 2.4), dark, 0, -2.3, -0.2);                         // foot base
      P(shinG, bevel(1.5, 0.35, 0.7), plate, 0, -2.15, -1.5);                      // toe
      P(shinG, bevel(1.0, 0.5, 0.6), dark, 0, -2.3, 1.0);                          // heel spur
      this.legs.push({ hip, shinG, side });
    }
    this.walkPhase = 0;

    // ================= ARMS =================
    // Segments stretch dramatically as the fist rockets out on a punch
    // (up to ~8u reach), so they are single tubular meshes that scale
    // cleanly along Y. The chrome forearm reads as an extending hydraulic
    // ram; nested concentric sleeves add read-through detail without
    // distorting under stretch. All the sculpted detail lives in the
    // fist (positioned + uniformly scaled) and the elbow actuator.
    this.arms = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      // upper arm: armored cylinder with a concentric cable sleeve
      const upper = new THREE.Group();
      P(upper, new THREE.CylinderGeometry(0.5, 0.44, 1, 10), main, 0, 0, 0);
      P(upper, new THREE.CylinderGeometry(0.6, 0.58, 0.28, 10), plate, 0, 0.34, 0); // shoulder cuff (stays tubular)
      // forearm: chromed piston ram + a darker outer housing at the elbow end
      const fore = new THREE.Group();
      P(fore, new THREE.CylinderGeometry(0.36, 0.34, 1, 10), piston, 0, 0, 0);      // bright ram core
      P(fore, new THREE.CylinderGeometry(0.52, 0.4, 0.5, 10), main, 0, 0.28, 0);    // forearm housing (elbow side)
      P(fore, new THREE.CylinderGeometry(0.4, 0.46, 0.22, 10), dark, 0, -0.42, 0);  // wrist collar (fist side)
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), piston);
      // fist: knuckle block + finger plates + emissive energy core
      const fist = new THREE.Group();
      P(fist, bevel(1.5, 1.3, 1.5), plate, 0, 0, 0);
      P(fist, bevel(1.62, 0.5, 1.62), dark, 0, 0.45, 0);       // knuckle ridge
      for (let k = -1; k <= 1; k++) P(fist, bevel(0.4, 0.55, 0.95), main, k * 0.45, 0.55, -0.35); // fingers
      P(fist, bevel(0.55, 0.9, 0.55), dark, 0, -0.2, 0.7);     // thumb
      P(fist, bevel(0.85, 0.32, 0.32), trim, 0, 0, -0.78);     // energy knuckleduster
      scene.add(upper, fore, elbow, fist);
      this.arms[side] = { s, upper, fore, elbow, fist, pos: new V3() };
    }

    // laser: bright core + wide soft sheath (bloom does the rest)
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1, 10),
      new THREE.MeshBasicMaterial({ color: '#ffffff' })
    );
    this.beam.visible = false;
    scene.add(this.beam);
    this.beamSheath = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 1, 12),
      new THREE.MeshBasicMaterial({ color: '#c95efb', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.beamSheath.visible = false;
    scene.add(this.beamSheath);
    this.beamGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#f3d9ff', transparent: true, opacity: 0.85 })
    );
    this.beamGlow.visible = false;
    scene.add(this.beamGlow);

    // targeting guide: the whole crew sees where the HEAD is pointing
    this.guide = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 1, 6),
      new THREE.MeshBasicMaterial({ color: '#c95efb', transparent: true, opacity: 0.5, depthWrite: false })
    );
    this.guide.visible = false;
    scene.add(this.guide);
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.3, 24),
      new THREE.MeshBasicMaterial({ color: '#c95efb', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    this.reticle.visible = false;
    scene.add(this.reticle);

    // rocket fists
    this.rocketMeshes = [];

    this.prevPos = new V3();
    this.velocity = new V3();
  }

  dispose(scene) {
    scene.remove(this.root, this.beam, this.beamSheath, this.beamGlow, this.guide, this.reticle);
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

    // warning light blinks slowly, glows harder while charging
    const blink = (Math.sin(performance.now() / 450) + 1) / 2;
    this.blinker.material.color.setRGB(1, 0.2 + blink * 0.2, 0.3);
    this.blinker.scale.setScalar(0.8 + blink * 0.5 + charge * 1.2);

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

    // laser beam + crew-visible targeting guide
    const eyeWorld = new V3(0, 0.12, -1.05).applyMatrix4(this.head.matrixWorld);
    if (mb.laser.firing && mb.laser.from && mb.laser.to) {
      const from = new V3(...mb.laser.from), to = new V3(...mb.laser.to);
      placeBeam(this.beam, from, to);
      placeBeam(this.beamSheath, from, to);
      const pulse = 0.9 + Math.random() * 0.35;
      this.beam.scale.x = pulse; this.beam.scale.z = pulse;
      this.beamSheath.scale.x = pulse * 1.2; this.beamSheath.scale.z = pulse * 1.2;
      this.beam.visible = this.beamSheath.visible = true;
      this.beamGlow.visible = true;
      this.beamGlow.position.copy(to);
      this.beamGlow.scale.setScalar(1 + Math.random() * 0.8);
      this.guide.visible = this.reticle.visible = false;
    } else {
      this.beam.visible = this.beamSheath.visible = this.beamGlow.visible = false;
      // guide line: thin normally, hot and thick while charging
      if (mb.laser.aim && !mb.ragdoll && !mb.dead) {
        const to = new V3(...mb.laser.aim);
        placeBeam(this.guide, eyeWorld, to);
        const gw = 1 + charge * 5;
        this.guide.scale.x = gw; this.guide.scale.z = gw;
        this.guide.material.opacity = 0.22 + charge * 0.6;
        this.guide.material.color.set(mb.laser.aimHit ? '#ff5da2' : '#c95efb');
        this.guide.visible = true;
        this.reticle.position.copy(to);
        this.reticle.quaternion.copy(CAMERA_Q);
        const rs = (mb.laser.aimHit ? 1.5 : 1) * (1 + charge * 1.2);
        this.reticle.scale.setScalar(rs);
        this.reticle.material.color.set(mb.laser.aimHit ? '#ff5da2' : '#c95efb');
        this.reticle.material.opacity = 0.45 + charge * 0.5;
        this.reticle.visible = true;
      } else {
        this.guide.visible = this.reticle.visible = false;
      }
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
  constructor(scene, style = VIEW_STYLES.crab) {
    this.scene = scene;
    this.style = style;
    this.baseScale = style.scale || 1;
    this.root = new THREE.Group();
    this.root.scale.setScalar(this.baseScale);
    scene.add(this.root);

    const shell = new THREE.MeshLambertMaterial({ color: style.shell });
    const belly = new THREE.MeshLambertMaterial({ color: style.belly });
    const dark = new THREE.MeshLambertMaterial({ color: style.dark });
    this.flashMats = [shell, belly, dark];

    const body = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 4.2), shell);
    body.castShadow = true;
    this.root.add(body);
    const under = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 3.4), belly);
    under.position.y = -1.1;
    this.root.add(under);

    // predator eye slits — dangerous, not adorable
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.3),
        new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 1.1, 1.6, -2.1);
      eye.rotation.z = -s * 0.28;
      this.root.add(eye);
      this.eyes.push({ eye });
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

    if (style.armored) {
      // riveted plates for the tank
      for (const [px, py, pz] of [[0, 1.5, 0], [-1.8, 0.9, -1.2], [1.8, 0.9, -1.2], [0, 0.9, 1.6]]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2),
          new THREE.MeshLambertMaterial({ color: '#3d434f' }));
        plate.position.set(px, py, pz);
        plate.rotation.y = px * 0.2;
        this.root.add(plate);
      }
    }
    if (style.crown) {
      // bosses get a tiny crown. it does nothing. it's perfect.
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 8),
        new THREE.MeshBasicMaterial({ color: '#ffd166' }));
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
    // crabs walk sideways-ish: face 60° off their travel direction (comedy + accuracy)
    this.root.rotation.y = lerpAngle(this.root.rotation.y, (mb.yaw ?? 0) + 0.6, 0.15);

    // white-hot hit flash + squash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.14);
      for (const m of this.flashMats) m.emissive.setScalar(k * 0.85);
    }

    if (mb.state === 'dead') {
      // flip over, sink
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

    // scuttle those little legs
    this.scuttle += dt * (this.style.scuttleRate || 9);
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

    // eye slits pulse hotter during telegraphs
    for (const e of this.eyes) {
      e.eye.material.color.set(tele ? '#ff6b3f' : '#ff2e3f');
    }

    this.bar.update(this.root.position, 5.2 * this.baseScale, mb.hp / mb.maxHp);
  }
}

// ===========================================================================
// SPITTER — a squat glob-lobbing toad-crab that refuses to fight fair.
// ===========================================================================
class SpitterView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const skin = new THREE.MeshLambertMaterial({ color: '#7aa843' });
    const belly = new THREE.MeshLambertMaterial({ color: '#c9e07a' });
    const dark = new THREE.MeshLambertMaterial({ color: '#4a6b28' });
    this.flashMats = [skin, belly, dark];

    const body = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), skin);
    body.scale.set(1.15, 0.8, 1.1);
    body.castShadow = true;
    this.root.add(body);
    this.throat = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), belly);
    this.throat.position.set(0, -0.6, -1.6);
    this.root.add(this.throat);
    this.snout = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 2.2, 8), dark);
    this.snout.rotation.x = Math.PI / 2.4;
    this.snout.position.set(0, 0.9, -2.2);
    this.root.add(this.snout);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 1.2, 1.6, -1.2);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      pupil.position.z = -0.34;
      eye.add(pupil);
      this.root.add(eye);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.8), dark);
      leg.position.set(s * 2.2, -1.8, 0.5);
      this.root.add(leg);
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
    // the throat inflates during the spit telegraph. gross. perfect.
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
// FLYER — a lean gull-thing that circles high and dive-bombs.
// ===========================================================================
class FlyerView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const grey = new THREE.MeshLambertMaterial({ color: '#d8d3c8' });
    const dark = new THREE.MeshLambertMaterial({ color: '#8f8878' });
    this.flashMats = [grey, dark];

    const body = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), grey);
    body.scale.set(0.9, 0.8, 1.6);
    body.castShadow = true;
    this.root.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), grey);
    head.position.set(0, 0.5, -2.3);
    this.root.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 6),
      new THREE.MeshLambertMaterial({ color: '#f2a65a' }));
    beak.rotation.x = -Math.PI / 2;
    beak.position.set(0, 0.4, -3.6);
    this.root.add(beak);
    for (const s of [-1, 1]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.16),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      brow.position.set(s * 0.5, 1.05, -2.6);
      brow.rotation.z = -s * 0.5;
      this.root.add(brow);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 0.5, 0.75, -2.7);
      this.root.add(eye);
    }
    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 4.6), dark);
      wing.geometry.translate(0, 0, 0);
      const g = new THREE.Group();
      g.position.set(s * 1.5, 0.4, 0);
      wing.position.set(s * 1.6, 0, 0.3);
      wing.rotation.y = s * 0.25;
      g.add(wing);
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
      this.root.rotation.z += dt * 6; // death spiral
      this.bar.sprite.visible = false;
      return;
    }
    // face travel direction, pitch into dives
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
    const skin = new THREE.MeshLambertMaterial({ color: '#c86bd6' });
    this.flashMats = [skin];
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 6), skin);
    body.castShadow = true;
    this.root.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
    eye.position.set(0, 0.25, -0.55);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6),
      new THREE.MeshLambertMaterial({ color: '#1d2033' }));
    pupil.position.z = -0.2;
    eye.add(pupil);
    this.root.add(eye);
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2),
        new THREE.MeshLambertMaterial({ color: '#7a3a85' }));
      leg.position.set(s * 0.4, -0.75, 0);
      this.root.add(leg);
      this.legs.push(leg);
    }
    this.run = Math.random() * 9;
    this.flashT = 0;
    this.bar = { update() {}, sprite: { visible: false } }; // too small for a bar
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
      // gnawing wiggle
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

    const grey = new THREE.MeshLambertMaterial({ color: '#9aa3b2' });
    const lite = new THREE.MeshLambertMaterial({ color: '#c6ccd6' });
    const green = new THREE.MeshLambertMaterial({ color: '#4d8f6b' });
    this.flashMats = [grey, lite, green];
    this.flashT = 0;

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
    // predator sensor slits + armored brow plates
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.08),
        new THREE.MeshBasicMaterial({ color: '#ff2e3f' }));
      eye.position.set(s * 0.68, 0.34, -1.04);
      eye.rotation.z = -s * 0.16;
      this.headG.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.2),
        new THREE.MeshLambertMaterial({ color: '#1d2033' }));
      brow.position.set(s * 0.68, 0.62, -0.98);
      brow.rotation.z = -s * 0.32;
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
const CAMERA_Q = new THREE.Quaternion();
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function hashStr(s) {
  let h = 9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
  return Math.abs(h ^ (h >>> 9));
}
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
