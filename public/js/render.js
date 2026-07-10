import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  V3, CAMERA_Q, lerp, easeOut, mulberry32,
} from '/js/gfx/util.js';
import {
  setMaxAnisotropy, stormSkyTex, smokeSprite, flareSprite, rainStreakTex,
  ringSprite, scorchSprite, concreteSet,
} from '/js/gfx/materials.js';
import { buildPost } from '/js/gfx/post.js';
import { MechView } from '/js/gfx/mech.js';
import { makeMonsterView } from '/js/gfx/monsters.js';
import * as WORLD from '/js/gfx/world.js';

// Everything visual. Art direction: STEEL RAIN — a grounded, filmic storm
// night. One committed palette (cold key light under an overcast deck lit
// by the burning city, sodium practicals, wet asphalt), physically-based
// materials everywhere, and a cinema post chain (ambient occlusion, tight
// bloom, teal–orange grade, grain, vignette). The camera behaves like a
// long-lens documentary rig: rotational shake, FOV kicks, handheld drift.

// One weather system, four moods — all the same storm, graded differently.
const PALETTES = [
  { name: 'steelrain', fog: '#10141d', fogD: 1.0, hemi: ['#4e5c78', '#14161e'], hemiI: 0.95,
    key: '#b6c6e4', keyI: 2.4, keyPos: [-70, 110, -50], warm: '#ff9a3c', warmI: 0.55, sky: '#ffffff' },
  { name: 'bruise', fog: '#131020', fogD: 1.05, hemi: ['#564e7c', '#14121e'], hemiI: 0.85,
    key: '#a9b2e0', keyI: 2.0, keyPos: [-40, 100, -80], warm: '#e07a5a', warmI: 0.45, sky: '#d9c9f0' },
  { name: 'sodium', fog: '#191410', fogD: 1.1, hemi: ['#6e5c48', '#161210'], hemiI: 0.95,
    key: '#c9c2b0', keyI: 2.0, keyPos: [60, 95, -40], warm: '#ff8a2e', warmI: 0.85, sky: '#ffd9b0' },
  { name: 'predawn', fog: '#18202c', fogD: 0.85, hemi: ['#64749a', '#181c26'], hemiI: 1.25,
    key: '#cdd8ec', keyI: 2.7, keyPos: [-90, 80, 30], warm: '#e8a05a', warmI: 0.4, sky: '#e2ecff' },
];

const RAIN_MAX = 1100;
const SPLASH_N = 26;

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    // storm deck: a slowly-turning cloud dome, lit from below at the horizon
    this.skyMat = new THREE.MeshBasicMaterial({ map: stormSkyTex(), side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(720, 36, 18), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2('#10141d', 0.0038);
    this.fogBaseD = 0.0038;
    this.fogTierMul = 1.0;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1400);
    this.baseFov = 55;
    this.fovKickV = 0;
    this.camDist = 30;
    this.trauma = 0;
    this.camPos = new V3(0, 20, 40);

    // ---- light rig: cold overcast key, warm city bounce, cool rim ----
    this.hemi = new THREE.HemisphereLight('#4e5c78', '#14161e', 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#b6c6e4', 2.4);
    this.sun.position.set(-70, 110, -50);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const S = 100;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.far = 500;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.bias = -0.0002;
    this.scene.add(this.sun);
    // sodium bounce off the streets — the warm half of the teal/orange split
    this.fill = new THREE.DirectionalLight('#ff9a3c', 0.55);
    this.fill.position.set(55, 22, 45);
    this.scene.add(this.fill);
    // cool rim so hulls pop off the murk
    this.rim = new THREE.DirectionalLight('#7d9fff', 0.7);
    this.rim.position.set(-50, 35, -60);
    this.scene.add(this.rim);
    // camera fill: a faint "documentary crew light" that follows the shot so
    // the hero mech and nearby kaiju never collapse into silhouettes
    this.camFill = new THREE.DirectionalLight('#9fb4d9', 0.8);
    this.scene.add(this.camFill);
    this.scene.add(this.camFill.target);

    // image-based lighting: a tiny authored "night city" the PBR metals
    // reflect — cloud deck above, sodium wash low, neon accents
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8),
        new THREE.MeshBasicMaterial({ color: '#1c2536', side: THREE.BackSide })));
      const card = (color, w, h, x, y, z, ry = 0, rx = 0) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
        m.position.set(x, y, z); m.rotation.y = ry; m.rotation.x = rx;
        env.add(m);
      };
      card('#8fa8d9', 40, 18, 0, 30, 0, 0, Math.PI / 2);   // cloud glow overhead
      card('#ff9a3c', 60, 6, 0, -2, -30);                  // sodium strip north
      card('#c96a2e', 60, 6, 0, -2, 30, Math.PI);
      card('#4dfff0', 8, 14, -28, 8, 0, Math.PI / 2);      // neon accents
      card('#ff5da2', 8, 14, 28, 8, 0, -Math.PI / 2);
      this.scene.environment = pmrem.fromScene(env, 0.06).texture;
      if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.75;
    } catch (e) { /* PMREM unsupported: metals fall back to lit-only */ }

    // silhouetted outer skyline — the city continues into the murk
    const silGeos = [];
    const rng0 = mulberry32(3);
    for (let ring = 0; ring < 2; ring++) {
      const r = 210 + ring * 90;
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
      new THREE.MeshBasicMaterial({ color: '#0d1019' }));
    this.silhouettes.frustumCulled = false;
    this.scene.add(this.silhouettes);

    // drifting embers: hot flecks off the burning district
    const emberN = 70;
    this.emberPos = new Float32Array(emberN * 3);
    for (let i = 0; i < emberN; i++) {
      this.emberPos[i * 3] = (Math.random() - 0.5) * 130;
      this.emberPos[i * 3 + 1] = Math.random() * 30 + 1;
      this.emberPos[i * 3 + 2] = (Math.random() - 0.5) * 130;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.emberPts = new THREE.Points(emberGeo, new THREE.PointsMaterial({
      map: flareSprite(), color: '#ffb060', size: 0.7, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.emberPts.frustumCulled = false;
    this.scene.add(this.emberPts);
    this.embers = [];

    // ---- RAIN: instanced streak quads, wind-sheared, one draw call ----
    this.rainCount = 700;
    this.rainData = new Float32Array(RAIN_MAX * 4); // x,y,z,speed
    for (let i = 0; i < RAIN_MAX; i++) this.respawnDrop(i, true);
    this.rainMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.05, 1.6),
      new THREE.MeshBasicMaterial({
        map: rainStreakTex(), transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
      RAIN_MAX);
    this.rainMesh.count = this.rainCount;
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 5;
    this.scene.add(this.rainMesh);

    // rain splash rings cycling on the ground around the camera
    this.splashes = [];
    for (let i = 0; i < SPLASH_N; i++) this.splashes.push({ t: Math.random(), x: 0, z: 0 });
    this.splashMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: ringSprite(), transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      SPLASH_N);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 4;
    this.scene.add(this.splashMesh);

    // low ground mist sheets drifting through the district
    this.mistPlanes = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(150, 150),
        new THREE.MeshBasicMaterial({
          map: smokeSprite(), transparent: true, opacity: 0.055,
          depthWrite: false, color: '#9aa8c4',
        }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 1.5 + i * 1.6;
      m.renderOrder = 3;
      this.scene.add(m);
      this.mistPlanes.push({ m, drift: 0.4 + i * 0.3, phase: i * 2.1 });
    }

    // searchlights sweeping the deck
    this.searchlights = [];
    this.makeSearchlights();
    this.lightningT = 4 + Math.random() * 8;
    this.flash = 0;

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.mechViews = new Map();
    this.monsterViews = new Map();
    this.crateMeshes = [];
    this.propMeshes = new Map();
    this.projMeshes = new Map();
    this.ringViews = [];
    this.balloonView = null;
    this.particles = [];
    this.effects = [];
    this.beaconViews = [];
    this.pulsers = [];
    this.waterMats = [];

    // palette state (lerped on run start)
    this.palA = PALETTES[0]; this.palB = PALETTES[0]; this.palT = 1;
    this.applyPalette(this.palA);

    // cinema post chain: AO -> bloom -> grade -> tone map
    this.post = buildPost(this.renderer, this.scene, this.camera);
    this.composer = this.post.composer;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  makeSearchlights() {
    for (const s of this.searchlights) this.scene.remove(s.cone);
    this.searchlights = [];
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(14, 130, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: '#aebfff', transparent: true, opacity: 0.05,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      cone.geometry.translate(0, 65, 0);
      cone.rotation.x = Math.PI;
      cone.position.set((i - 1) * 90, 130, -60 + i * 60);
      this.scene.add(cone);
      this.searchlights.push({ cone, ph: i * 2.1 });
    }
  }

  respawnDrop(i, anywhere = false) {
    const d = this.rainData;
    d[i * 4] = this.camPos.x + (Math.random() - 0.5) * 130;
    d[i * 4 + 1] = anywhere ? Math.random() * 60 : 52 + Math.random() * 12;
    d[i * 4 + 2] = this.camPos.z + (Math.random() - 0.5) * 130;
    d[i * 4 + 3] = 34 + Math.random() * 22;
  }

  setQuality(q) {
    const dpr = window.devicePixelRatio || 1;
    const opts = {
      low: { pr: Math.min(dpr, 1) * 0.85, shadows: false, gtao: false, bloom: 0.32, fogM: 1.5, rain: 300, mist: false, embers: false },
      medium: { pr: Math.min(dpr, 1.75), shadows: true, gtao: false, bloom: 0.5, fogM: 1.0, rain: 700, mist: true, embers: true },
      high: { pr: Math.min(dpr, 2), shadows: true, gtao: true, bloom: 0.6, fogM: 0.82, rain: RAIN_MAX, mist: true, embers: true },
    }[q];
    if (!opts) return;
    this.renderer.setPixelRatio(opts.pr);
    this.renderer.shadowMap.enabled = opts.shadows;
    this.sun.castShadow = opts.shadows;
    this.post.ensureGtao(opts.gtao);
    this.post.bloom.strength = opts.bloom;
    this.fogTierMul = opts.fogM;
    this.rainCount = opts.rain;
    this.rainMesh.count = opts.rain;
    for (const mp of this.mistPlanes) mp.m.visible = opts.mist;
    this.emberPts.visible = opts.embers;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  shake(amount) {
    // global budget: single hits clamp at 0.9, total never exceeds 1.2
    const a = Math.min(0.9, amount) * (this.shakeMult ?? 1);
    this.trauma = Math.min(1.2, this.trauma + a);
    this.fovKickV = Math.min(4, this.fovKickV + a * 2.2);
  }

  // hull-critical grade: red bleed at the frame edges (0..1)
  setHurt(v) {
    this.post.grade.uniforms.uHurt.value = Math.max(0, Math.min(1, v)) * 0.5;
  }

  // ------------------------------------------------ palettes / atmosphere
  setPalette(i) {
    this.palA = this.currentPalette();
    this.palB = PALETTES[((i % PALETTES.length) + PALETTES.length) % PALETTES.length];
    this.palT = 0;
  }

  currentPalette() {
    const t = this.palT, a = this.palA, b = this.palB;
    const mix = (x, y) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
    return {
      fog: mix(a.fog, b.fog),
      fogD: lerp(a.fogD, b.fogD, t),
      hemi: [mix(a.hemi[0], b.hemi[0]), mix(a.hemi[1], b.hemi[1])],
      hemiI: lerp(a.hemiI, b.hemiI, t),
      key: mix(a.key, b.key),
      keyI: lerp(a.keyI, b.keyI, t),
      keyPos: a.keyPos.map((v, i) => lerp(v, b.keyPos[i], t)),
      warm: mix(a.warm, b.warm),
      warmI: lerp(a.warmI, b.warmI, t),
      sky: mix(a.sky, b.sky),
    };
  }

  applyPalette(pal) {
    this.scene.fog.color.set(pal.fog);
    this.fogBaseD = 0.0038 * pal.fogD;
    this.hemi.color.set(pal.hemi[0]);
    this.hemi.groundColor.set(pal.hemi[1]);
    this.hemi.intensity = pal.hemiI;
    this.sun.color.set(pal.key);
    this.sun.intensity = pal.keyI;
    this.sun.position.set(...pal.keyPos);
    this.fill.color.set(pal.warm);
    this.fill.intensity = pal.warmI;
    this.skyMat.color.set(pal.sky);
  }

  stepAtmosphere(dt) {
    if (this.palT < 1) {
      this.palT = Math.min(1, this.palT + dt / 3.5);
      this.applyPalette(this.currentPalette());
    }
    const t = performance.now() / 1000;
    this.sky.rotation.y = t * 0.0045;
    this.sky.position.copy(this.camPos);

    // WIND: slow gust cycles shear the rain and make the storm breathe
    const gust = Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.047 + 2) * 0.4; // -1..1
    const windX = gust * 16;

    // rain streaks: shared shear orientation, per-drop fall
    const d = this.rainData;
    const tilt = Math.atan2(windX, 44);
    const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), -tilt);
    // face the camera around Y so the streak quads never vanish edge-on
    const camYaw = Math.atan2(
      this.camera.position.x - this.camPos.x + 0.001,
      this.camera.position.z - this.camPos.z + 0.001);
    const qy = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), camYaw);
    qy.multiply(q);
    const m4 = new THREE.Matrix4();
    const pv = new V3();
    const scl = new V3();
    let splashSpawn = 0;
    for (let i = 0; i < this.rainCount; i++) {
      const sp = d[i * 4 + 3] * (1 + Math.abs(gust) * 0.4);
      d[i * 4] += windX * dt;
      d[i * 4 + 1] -= sp * dt;
      if (d[i * 4 + 1] < 0.2) {
        // recycle the drop; occasionally hand its position to a splash
        if (splashSpawn < 4) {
          const s = this.splashes[(this._splashI = ((this._splashI || 0) + 1) % SPLASH_N)];
          if (s.t > 0.85) { s.t = 0; s.x = d[i * 4]; s.z = d[i * 4 + 2]; splashSpawn++; }
        }
        this.respawnDrop(i);
      }
      scl.set(1, 0.8 + sp * 0.014, 1);
      pv.set(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      m4.compose(pv, qy, scl);
      this.rainMesh.setMatrixAt(i, m4);
    }
    this.rainMesh.instanceMatrix.needsUpdate = true;
    this.rainMesh.material.opacity = 0.55 + Math.abs(gust) * 0.3;

    // splash rings expand and die
    const sq = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -Math.PI / 2);
    for (let i = 0; i < SPLASH_N; i++) {
      const s = this.splashes[i];
      s.t = Math.min(1, s.t + dt * 2.6);
      if (!s.x) { s.x = this.camPos.x + (Math.random() - 0.5) * 60; s.z = this.camPos.z + (Math.random() - 0.5) * 60; }
      const k = s.t;
      scl.setScalar(0.25 + k * 1.6 * (1 - k * 0.35));
      pv.set(s.x, 0.08, s.z);
      m4.compose(pv, sq, scl);
      this.splashMesh.setMatrixAt(i, m4);
    }
    this.splashMesh.instanceMatrix.needsUpdate = true;

    // mist sheets drift with the wind
    for (const mp of this.mistPlanes) {
      mp.m.position.x = this.camPos.x + Math.sin(t * 0.05 + mp.phase) * 30;
      mp.m.position.z = this.camPos.z + Math.cos(t * 0.04 + mp.phase) * 30;
      mp.m.rotation.z = t * 0.008 * mp.drift;
      mp.m.material.opacity = 0.04 + Math.abs(gust) * 0.03;
    }

    // fog breathes with the gusts
    this.scene.fog.density = this.fogBaseD * this.fogTierMul * (1 + Math.abs(gust) * 0.14);

    // searchlights sweep slowly
    for (const s of this.searchlights) {
      s.cone.rotation.z = Math.sin(t * 0.21 + s.ph) * 0.5;
      s.cone.rotation.x = Math.PI + Math.cos(t * 0.17 + s.ph) * 0.35;
    }

    // aviation beacons pulse
    for (const p of this.pulsers) {
      p.material.emissiveIntensity = 1.4 + (Math.sin(t * 2.4 + p.position.x) + 1) * 1.4;
    }
    // river scroll
    for (const wm of this.waterMats) {
      if (wm.normalMap) wm.normalMap.offset.y = (t * 0.03) % 1;
    }

    // lightning: hemi flash + an actual bolt on the horizon, thunder later
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightningT = 6 + Math.random() * 14;
      this.flash = 1;
      this.thunderT = 0.4 + Math.random() * 1.4;
      this.spawnBolt();
    }
    if (this.thunderT != null) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) { this.thunderT = null; this.thunderReady = true; }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      this.hemi.intensity = (this.palB.hemiI ?? 0.6) + this.flash * 1.7;
    }
    const ep = this.emberPos;
    for (let i = 0; i < ep.length; i += 3) {
      ep[i + 1] += dt * 0.7;
      if (ep[i + 1] > 32) ep[i + 1] = 0.5;
    }
    this.emberPts.geometry.attributes.position.needsUpdate = true;
    this.emberPts.material.opacity = 0.3 + 0.2 * Math.sin(t * 2);
  }

  // a jagged cloud-to-ground strike out past the skyline
  spawnBolt() {
    const a = Math.random() * Math.PI * 2;
    const r = 260 + Math.random() * 160;
    const x = this.camPos.x + Math.cos(a) * r;
    const z = this.camPos.z + Math.sin(a) * r;
    const pts = [];
    let bx = x, bz = z;
    for (let y = 200; y >= 0; y -= 200 / 7) {
      pts.push(new V3(bx, y, bz));
      bx += (Math.random() - 0.5) * 26;
      bz += (Math.random() - 0.5) * 26;
    }
    const m = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.7, 5),
      new THREE.MeshBasicMaterial({
        color: '#d9e6ff', transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 0.22, kind: 'bolt' });
  }

  // ------------------------------------------------------- effect spawns
  ring(pos, color = '#ffd9a0', maxR = 14, dur = 0.55) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.35, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos[0], Math.max(0.25, pos[1] - 6), pos[2]);
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur, maxR, kind: 'ring' });
  }

  // volumetric-feeling smoke: textured sprite, random roll, grows + fades
  smoke(pos, size = 1.4, color = '#8a8a94') {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeSprite(), color, transparent: true, opacity: 0.55,
      depthWrite: false, rotation: Math.random() * Math.PI * 2,
    }));
    m.position.set(pos[0] + (Math.random() - 0.5), pos[1], pos[2] + (Math.random() - 0.5));
    m.scale.setScalar(size * (1.6 + Math.random()));
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 1.3, kind: 'smoke', rise: 3 + Math.random() * 2, spin: (Math.random() - 0.5) * 1.2 });
    const smokes = this.effects.filter((e) => e.kind === 'smoke');
    if (smokes.length > 60) { smokes[0].t = smokes[0].dur; }
  }

  // hot flash at a world point (gunfire / rocket launch / detonation)
  muzzle(pos, color = '#fff2c0', size = 2.4) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flareSprite(), color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, rotation: Math.random() * Math.PI,
    }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.setScalar(size * 2.2);
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 0.12, kind: 'muzzle' });
  }

  // white-hot metal sparks that streak and die
  sparks(pos, n = 10, color = '#ffd9a0', speed = 18) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.6),
        new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 1, depthWrite: false }));
      m.position.set(pos[0], pos[1], pos[2]);
      this.scene.add(m);
      this.effects.push({
        m, t: 0, dur: 0.35 + Math.random() * 0.3, kind: 'spark',
        v: new V3((Math.random() - 0.5) * speed, Math.random() * speed * 0.7, (Math.random() - 0.5) * speed),
      });
    }
  }

  scorch(pos, r = 3.2) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2, r * 2),
      new THREE.MeshBasicMaterial({ map: scorchSprite(), transparent: true, opacity: 0.95, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(pos[0], 0.08 + Math.random() * 0.03, pos[2]);
    this.scene.add(m);
    this.effects.push({ m, t: 0, dur: 11, kind: 'scorch' });
    const scorches = this.effects.filter((e) => e.kind === 'scorch');
    if (scorches.length > 26) { const old = scorches[0]; old.t = old.dur; }
  }

  // ballistic concrete chunk: tumbles, bounces once, settles, fades
  debrisChunk(p, v, size = 1) {
    const set = concreteSet();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * (0.6 + Math.random() * 0.7), size * (0.5 + Math.random())),
      new THREE.MeshStandardMaterial({ color: '#55525c', map: set.map, roughness: 0.95, metalness: 0.05, flatShading: true, transparent: true })
    );
    m.position.set(p[0], p[1], p[2]);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = true;
    this.scene.add(m);
    this.effects.push({
      m, t: 0, dur: 2.6, kind: 'chunk',
      v: new V3(v[0], v[1], v[2]),
      rv: { x: (Math.random() - 0.5) * 9, z: (Math.random() - 0.5) * 9 },
      half: size * 0.4, grounded: false,
    });
    const chunks = this.effects.filter((e) => e.kind === 'chunk');
    if (chunks.length > 40) chunks[0].t = chunks[0].dur;
  }

  stepEffects(dt) {
    const zAxis = new V3(0, 0, 1);
    for (const e of this.effects) {
      e.t += dt;
      const k = e.t / e.dur;
      if (e.kind === 'chunk') {
        if (!e.grounded) {
          e.v.y -= 42 * dt;
          e.m.position.addScaledVector(e.v, dt);
          e.m.rotation.x += e.rv.x * dt;
          e.m.rotation.z += e.rv.z * dt;
          if (e.m.position.y <= e.half) {
            e.m.position.y = e.half;
            if (Math.abs(e.v.y) > 9) {
              e.v.y = Math.abs(e.v.y) * 0.35;         // one hard bounce
              e.v.x *= 0.5; e.v.z *= 0.5;
              e.rv.x *= 0.5; e.rv.z *= 0.5;
            } else {
              e.grounded = true;                       // settle in the rubble
            }
          }
        }
        e.m.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        if (e.t >= e.dur) this.scene.remove(e.m);
        continue;
      }
      if (e.kind === 'spark') {
        e.v.y -= 34 * dt;
        e.m.position.addScaledVector(e.v, dt);
        if (e.v.lengthSq() > 0.01) e.m.quaternion.setFromUnitVectors(zAxis, e.v.clone().normalize());
        e.m.material.opacity = 1 - k;
        if (e.m.position.y < 0.05) e.t = e.dur;
        if (e.t >= e.dur) this.scene.remove(e.m);
        continue;
      }
      if (e.kind === 'bolt') {
        e.m.material.opacity = (Math.random() < 0.4 ? 0.4 : 1) * (1 - k);
        if (e.t >= e.dur) this.scene.remove(e.m);
        continue;
      }
      if (e.kind === 'ring') {
        const s = 1 + (e.maxR - 1) * easeOut(Math.min(1, k));
        e.m.scale.set(s, s, 1);
        e.m.material.opacity = 0.95 * (1 - k);
      } else if (e.kind === 'scorch') {
        e.m.material.opacity = 0.95 * (1 - Math.max(0, k - 0.7) / 0.3);
      } else if (e.kind === 'smoke') {
        e.m.position.y += e.rise * dt;
        e.m.material.rotation += e.spin * dt;
        e.m.scale.addScalar(dt * 3.2);
        e.m.material.opacity = 0.55 * (1 - k);
      } else if (e.kind === 'muzzle') {
        e.m.scale.addScalar(dt * 26);
        e.m.material.opacity = 1 - k;
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
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    for (let i = 0; i < RAIN_MAX; i++) this.respawnDrop(i, true);
    this.lightningT = 4 + Math.random() * 8;
    this.flash = 0;
    for (const v of this.mechViews.values()) v.dispose(this.scene);
    for (const v of this.monsterViews.values()) v.dispose(this.scene);
    this.mechViews.clear();
    this.monsterViews.clear();
    this.crateMeshes = [];
    this.ringViews = [];
    this.balloonView = null;
    this.pulsers = [];
    this.waterMats = [];
  }

  buildWorld(world) { WORLD.buildWorld(this, world); }
  collapseBuilding(id, vfx = true) { WORLD.collapseBuilding(this, id, vfx); }

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
    this._trPrev = this._trPrev || new Map();
    let ti = 0, mi = 0;
    for (const mb of b.mechs) {
      for (const tr of mb.tracers || []) {
        let mesh = this._weaponPool.tracers[ti];
        if (!mesh) {
          // elongated glowing round — reads as a tracer streak, not a ball
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.0, 6),
            new THREE.MeshBasicMaterial({ color: '#ffedb8', blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false }));
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
          mesh = new THREE.Group();
          const body = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.0, 8),
            new THREE.MeshStandardMaterial({ color: '#8f9099', metalness: 0.8, roughness: 0.4 }));
          mesh.add(body);
          const flame = new THREE.Sprite(new THREE.SpriteMaterial({
            map: flareSprite(), color: '#ffb35c', transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          flame.scale.setScalar(2.6);
          flame.position.y = -1.4;
          mesh.add(flame);
          this.scene.add(mesh); this._weaponPool.missiles[mi] = mesh;
        }
        mesh.visible = true; mesh.position.set(ms.p[0], ms.p[1], ms.p[2]); mesh.rotation.x += dt * 8;
        // smoke trail: drop a fading puff behind the rocket
        if (Math.random() < 0.7) this.smoke(ms.p, 0.9);
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
          new THREE.MeshStandardMaterial({
            color: '#243d08', emissive: new THREE.Color('#9dff5c'), emissiveIntensity: 1.8, roughness: 0.25,
          }));
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
          new THREE.MeshStandardMaterial({ color: '#4a3a10', emissive: new THREE.Color('#ffd166'), emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.3 }));
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
      b.inter.stations?.forEach((st, i) => {
        const v = this.stationViews[i];
        if (!v) return;
        v.visible = st.alive;
        if (v.userData.holo) { v.userData.holo.rotation.y += dt * 1.2; v.userData.holo.position.y = 7 + Math.sin(performance.now() / 600) * 0.4; }
      });
    }
    // downed buildings: snapshot state is the source of truth (idempotent;
    // the bldgDown event supplies the collapse VFX when it happens live)
    if (b.bldg) for (const id of b.bldg) this.collapseBuilding(id, false);
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
          ring.material.emissive.set(done ? '#2a9d8f' : '#f5d76e');
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
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, flatShading: true })
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

  dust(pos, n = 8) { this.burst(pos, '#8d8578', n, 8); }

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

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(target);
    this.camFill.position.copy(this.camPos);
    this.camFill.target.position.copy(target);

    // handheld documentary drift + trauma-driven ROTATIONAL shake — the
    // world stays put, the operator flinches
    const t = performance.now() / 1000;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const t2 = this.trauma * this.trauma;
    const drift = 0.0035;
    const rx = Math.sin(t * 0.42) * drift + Math.sin(t * 1.13) * drift * 0.4 + (Math.random() - 0.5) * 0.05 * t2;
    const ry = Math.cos(t * 0.31) * drift * 1.3 + (Math.random() - 0.5) * 0.05 * t2;
    const rz = Math.sin(t * 0.23) * drift * 0.7 + (Math.random() - 0.5) * 0.035 * t2;
    this.camera.rotateX(rx); this.camera.rotateY(ry); this.camera.rotateZ(rz);
    // small positional jolt for the heaviest hits only
    if (t2 > 0.2) {
      this.camera.position.add(new V3(
        (Math.random() - 0.5) * 0.9 * t2, (Math.random() - 0.5) * 0.9 * t2, 0));
    }
    CAMERA_Q.copy(this.camera.quaternion);

    // impact FOV kick: a fast punch-in that eases back out
    this.fovKickV = Math.max(0, this.fovKickV - dt * 14);
    const wantFov = this.baseFov + this.fovKickV;
    if (Math.abs(wantFov - this.camera.fov) > 0.01) {
      this.camera.fov = wantFov;
      this.camera.updateProjectionMatrix();
    }

    this.stepAtmosphere(dt);
    this.stepEffects(dt);
    this.post.step(dt);
  }

  flashMonster(id) {
    this.monsterViews.get(id)?.flash?.();
  }

  render() { this.post.render(); }
}
