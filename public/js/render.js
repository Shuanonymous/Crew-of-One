import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MECH } from '/shared/constants.js';
import { DEFAULT_BUILD } from '/shared/loadout.js';
import { buildMech } from '/js/mechfab.js';
import { makeMonsterView } from '/js/monsterfab.js';
import { Atmosphere } from '/js/atmosphere.js';
import * as CITY from '/js/cityfab.js';

// ===========================================================================
// RENDERER v2 — cinematic pipeline.
//   - modular kitbash mech (mechfab) with IK-articulated limbs
//   - district city (cityfab) with archetype facades + scale cues
//   - dynamic weather (atmosphere) with streak rain and rolling fronts
//   - close over-shoulder combat camera with dynamic FOV + collision
//   - filmic tonemapping, restrained bloom, key/rim/practical light rig
// ===========================================================================

const V3 = THREE.Vector3;
const CAMERA_Q = new THREE.Quaternion();

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.atmo = new Atmosphere(this.scene);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 1100);
    this.camDist = 16.5;
    this.fovBase = 56;
    this.fovKick = 0;
    this.trauma = 0;
    this.camPos = new V3(0, 16, 34);

    // city texture bank + skyline (built once)
    this.cityTex = new CITY.CityTextures(this.renderer);
    this.matBank = CITY.makeMatBank();
    CITY.buildSkyline(this.scene);

    // camera-side character fill: keeps the hull readable when the key is
    // behind the mech (over-shoulder framing) without flattening the scene
    this.camFill = new THREE.DirectionalLight('#8fa5cc', 0.95);
    this.scene.add(this.camFill, this.camFill.target);

    // drifting embers / dust motes — ROUND soft sprites, never squares
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
      color: '#ffcf8a', size: 0.4, transparent: true, opacity: 0.45,
      map: roundSprite(), depthWrite: false,
    }));
    this.emberPts.frustumCulled = false;
    this.scene.add(this.emberPts);

    // searchlights sweeping the district
    this.searchlights = [];
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(14, 130, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: '#aebfff', transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      cone.geometry.translate(0, 65, 0);
      cone.rotation.x = Math.PI;
      cone.position.set((i - 1) * 90, 130, -60 + i * 60);
      this.scene.add(cone);
      this.searchlights.push({ cone, ph: i * 2.1 });
    }

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
    this.beaconViews = [];         // endless has no beacons; e2e asserts empty

    // environment reflections: PBR metal catches the night city glow
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color('#10131f');
      const glow = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#33405e', side: THREE.BackSide }));
      envScene.add(glow);
      const warm = new THREE.PointLight('#ffb066', 32, 200); warm.position.set(20, 6, 20); envScene.add(warm);
      const cool = new THREE.PointLight('#4d7dff', 30, 200); cool.position.set(-25, 14, -15); envScene.add(cool);
      this.scene.environment = pmrem.fromScene(envScene).texture;
    } catch (e) { /* PMREM unsupported: metal falls back to lit-only */ }

    const rtSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    const opts = {
      low: { pr: 0.8, shadows: false, bloom: 0, fogScale: 0.6 },
      medium: { pr: Math.min(window.devicePixelRatio, 1.75), shadows: true, bloom: 0.4, fogScale: 0.9 },
      high: { pr: Math.min(window.devicePixelRatio, 2), shadows: true, bloom: 0.5, fogScale: 1.1 },
    }[q] || {};
    if (!opts.pr) return;
    this.renderer.setPixelRatio(opts.pr);
    this.renderer.shadowMap.enabled = opts.shadows;
    this.atmo.key.castShadow = opts.shadows;
    if (this.bloom) this.bloom.strength = opts.bloom;
    this.atmo.fogScale = opts.fogScale;
    this.atmo.setQuality(q);
    this.emberPts.visible = q !== 'low';
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
    const a = Math.min(0.9, amount) * (this.shakeMult ?? 1);
    this.trauma = Math.min(1.2, this.trauma + a);
  }

  // legacy hook (was palette cycling): a fresh run rolls fresh weather
  setPalette() {
    const opts = ['storm', 'rain', 'overcast', 'clearNight', 'golden', 'dawn'];
    this.atmo.setWeather(opts[Math.floor(Math.random() * opts.length)], true);
    this.atmo.auto = true;
  }
  setWeather(name, instant) { this.atmo.setWeather(name, instant); }
  get thunderReady() { return this.atmo.thunderReady; }
  set thunderReady(v) { this.atmo.thunderReady = v; }

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
    const scorches = this.effects.filter((e) => e.kind === 'scorch');
    if (scorches.length > 26) { const old = scorches[0]; old.t = old.dur; }
  }

  debrisChunk(p, v, size = 1) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * (0.6 + Math.random() * 0.7), size * (0.5 + Math.random())),
      new THREE.MeshStandardMaterial({ color: '#4a4854', roughness: 0.95, metalness: 0.06, flatShading: true, transparent: true })
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
              e.v.y = Math.abs(e.v.y) * 0.35;
              e.v.x *= 0.5; e.v.z *= 0.5;
              e.rv.x *= 0.5; e.rv.z *= 0.5;
            } else {
              e.grounded = true;
            }
          }
        }
        e.m.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        if (e.t >= e.dur) this.scene.remove(e.m);
        continue;
      }
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
    if (v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  // ------------------------------------------------------------ world
  clearWorld() {
    this.scene.remove(this.worldGroup);
    this.worldGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    for (const v of this.mechViews.values()) v.dispose(this.scene);
    for (const v of this.monsterViews.values()) v.dispose(this.scene);
    this.mechViews.clear();
    this.monsterViews.clear();
    this.crateMeshes = [];
    this.ringViews = [];
    this.balloonView = null;
    this.beaconViews = [];
  }

  buildWorld(world) {
    this.clearWorld();
    const g = this.worldGroup;
    const tex = this.cityTex;
    this.bldgDefs = [];
    this.bldgDown = new Set();
    this.bldgDeco = new Map();
    this.bldgBatchMeshes = [];
    this.bldgMats = this.bldgMats || new Map();

    const lamps = [], traffic = [], parked = [];
    for (const d of world.city || []) {
      if (d.kind === 'ground') CITY.buildGround(g, d, tex);
      else if (d.kind === 'river') {
        // flood channel: dark water + concrete embankment walls
        const water = new THREE.Mesh(
          new THREE.PlaneGeometry(d.size[0], d.size[1]),
          new THREE.MeshStandardMaterial({ color: '#0a1524', metalness: 0.9, roughness: 0.15, envMapIntensity: 1.6 })
        );
        water.rotation.x = -Math.PI / 2;
        water.position.set(d.p[0], d.p[1], d.p[2]);
        g.add(water);
        for (const s of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, d.size[1]),
            new THREE.MeshStandardMaterial({ color: '#4d5260', roughness: 0.85 }));
          wall.position.set(d.p[0] + s * (d.size[0] / 2 + 0.7), 1.2, d.p[2]);
          wall.castShadow = wall.receiveShadow = true;
          g.add(wall);
        }
      } else if (d.kind === 'roadgrid') CITY.buildRoadMarkings(g, d);
      else if (d.kind === 'building') {
        this.bldgDefs.push(d);
        const deco = new THREE.Group();
        g.add(deco);
        if (d.id != null) this.bldgDeco.set(d.id, deco);
        CITY.decorateBuilding(deco, d, tex, this.matBank);
      } else if (d.kind === 'landmark') this.buildLandmark(g, d, tex);
      else if (d.kind === 'lamp') lamps.push(d);
      else if (d.kind === 'traffic') traffic.push(d);
      else if (d.kind === 'parked') parked.push(d);
      else if (d.kind === 'crane') CITY.buildCrane(g, d);
      else if (d.kind === 'billboard') this.addBillboard(g, d);
      else if (d.kind === 'disc') {
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(d.size[0], 40),
          new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.9 }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(...d.p);
        mesh.receiveShadow = true;
        g.add(mesh);
      }
    }
    this.rebuildBuildingBatches();
    CITY.buildLamps(g, lamps);
    CITY.buildTraffic(g, traffic);
    CITY.buildParked(g, parked);
    this.buildSidewalks(g);
    this.buildDamage(g, world);

    // interactables
    this.tankViews = [];
    for (const t of world.tanks || []) this.tankViews.push(this.buildFuelTank(g, t));
    this.stationViews = [];
    for (const s of world.stations || []) this.stationViews.push(this.buildStation(g, s));
    this.cacheViews = [];
    for (const c of world.caches || []) this.cacheViews.push(this.buildCache(g, c));
    this.pickupMeshes = new Map();

    // training props
    if (world.rings) {
      for (const r of world.rings) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.65, 10, 32),
          new THREE.MeshBasicMaterial({ color: '#f5d76e' }));
        ring.position.set(r.p[0], 7, r.p[2]);
        g.add(ring);
        this.ringViews.push(ring);
      }
    }
    if (world.balloon) {
      const b = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(world.balloon.radius, 1),
        new THREE.MeshStandardMaterial({ color: '#ef767a', flatShading: true }));
      b.add(ball);
      b.position.set(...world.balloon.p);
      g.add(b);
      this.balloonView = b;
    }
    if (world.crateSize) {
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(
          new THREE.BoxGeometry(world.crateSize, world.crateSize, world.crateSize),
          new THREE.MeshStandardMaterial({ color: ['#8f7a3d', '#7a4f42', '#3d6e63', '#6b5578'][i], roughness: 0.8 })
        );
        c.castShadow = c.receiveShadow = true;
        g.add(c);
        this.crateMeshes.push(c);
      }
    }

    // dynamic cars (puntable)
    this.propMeshes.clear();
    for (const d of world.props || []) {
      const car = makeCarMesh(d);
      g.add(car);
      this.propMeshes.set(d.id, car);
    }
  }

  buildLandmark(g, d, tex) {
    const [lw, lh, ld] = d.size;
    const mat = new THREE.MeshLambertMaterial({
      color: '#42536b', map: tex.facades.glass.map,
      emissive: new THREE.Color('#ffffff'), emissiveMap: tex.facades.glass.emissive, emissiveIntensity: 0.85,
    });
    const trim = new THREE.MeshStandardMaterial({ color: '#39415c', metalness: 0.7, roughness: 0.4 });
    const baseY = d.p[1] - lh / 2;
    const tiers = [[1.0, 0.58], [0.78, 0.26], [0.55, 0.13]];
    let ty = baseY;
    for (const [scale, frac] of tiers) {
      const th = lh * frac;
      const tier = new THREE.Mesh(
        CITY.worldUVBox(new THREE.BoxGeometry(lw * scale, th, ld * scale), lw * scale, th, ld * scale), mat);
      tier.position.set(d.p[0], ty + th / 2, d.p[2]);
      tier.castShadow = true;
      g.add(tier);
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(lw * scale + 0.8, 0.7, ld * scale + 0.8), trim);
      ledge.position.set(d.p[0], ty + th, d.p[2]);
      g.add(ledge);
      ty += th;
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, lh * 0.14, 8), trim);
    mast.position.set(d.p[0], ty + lh * 0.07, d.p[2]);
    g.add(mast);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
    cap.position.set(d.p[0], ty + lh * 0.14 + 1, d.p[2]);
    g.add(cap);
  }

  buildFuelTank(g, t) {
    const grp = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: '#b8622e', metalness: 0.6, roughness: 0.45 });
    const steel = new THREE.MeshStandardMaterial({ color: '#3a3f4d', metalness: 0.8, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.8, 14), shell);
    body.position.y = 2.1; body.castShadow = true;
    grp.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    dome.position.y = 4.0;
    grp.add(dome);
    for (const ry of [1.1, 3.1]) {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(2.12, 2.12, 0.22, 14), steel);
      rib.position.y = ry;
      grp.add(rib);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.06, 2.06, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: '#1a1206', emissive: new THREE.Color('#ff8a1e'), emissiveIntensity: 1.1, roughness: 0.5 }));
    band.position.y = 2.1;
    grp.add(band);
    grp.position.set(t.p[0], 0, t.p[2]);
    g.add(grp);
    return grp;
  }

  buildStation(g, s) {
    const grp = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: '#24404f', metalness: 0.7, roughness: 0.4 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.5, 20), steel);
    pad.position.y = 0.25;
    grp.add(pad);
    const glow = new THREE.Mesh(new THREE.RingGeometry(7.5, 8.6, 30),
      new THREE.MeshBasicMaterial({ color: '#5cff8f', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.6;
    grp.add(glow);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const py = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4.2, 8), steel);
      py.position.set(Math.cos(a) * 8.2, 2.1, Math.sin(a) * 8.2);
      grp.add(py);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#5cff8f' }));
      tip.position.set(Math.cos(a) * 8.2, 4.4, Math.sin(a) * 8.2);
      grp.add(tip);
    }
    const holo = new THREE.Group();
    const hm = new THREE.MeshBasicMaterial({ color: '#5cff8f', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    holo.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.3), hm));
    holo.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 3.2, 0.3), hm));
    holo.position.y = 7;
    grp.add(holo);
    grp.userData.holo = holo;
    grp.position.set(s.p[0], 0, s.p[2]);
    g.add(grp);
    return grp;
  }

  buildCache(g, c) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(3, 3, 3, 2, 0.22),
      new THREE.MeshStandardMaterial({ color: '#8f7a2e', metalness: 0.55, roughness: 0.5 }));
    body.castShadow = true;
    grp.add(body);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.18, 3.06),
      new THREE.MeshBasicMaterial({ color: '#ffd166' }));
    seam.position.y = 0.6;
    grp.add(seam);
    grp.position.set(c.p[0], 1.5, c.p[2]);
    grp.rotation.y = 0.5;
    g.add(grp);
    return grp;
  }

  buildSidewalks(g) {
    const slabs = [];
    for (const d of this.bldgDefs) {
      const [w, , dd] = d.size;
      const s = new THREE.BoxGeometry(w + 3, 0.28, dd + 3);
      if (d.yaw) s.rotateY(d.yaw);
      s.translate(d.p[0], 0.14, d.p[2]);
      slabs.push(s);
    }
    if (slabs.length) {
      const m = new THREE.Mesh(mergeGeometries(slabs),
        new THREE.MeshStandardMaterial({ color: '#565b66', metalness: 0.15, roughness: 0.9 }));
      m.receiveShadow = true;
      g.add(m);
    }
  }

  buildDamage(g, world) {
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
      const h = CITY.hashStr('dmg' + d.p[0] + '_' + d.p[2]);
      const rng = CITY.mulberry32(h);
      const [w, bh, dp] = d.size;
      const topY = d.p[1] + bh / 2;
      if (h % 100 < 40 && !d.tiers) {
        const attached = [];
        const teeth = 3 + (h % 4);
        for (let i = 0; i < teeth; i++) {
          const tw = w * (0.18 + rng() * 0.22);
          const th = 1.5 + rng() * (bh * 0.14);
          const ex = (rng() - 0.5) * (w - tw);
          const ez = (rng() - 0.5) * (dp - tw);
          pushBox(attached, tw, th, tw, d.p[0] + ex, topY + th / 2 - 0.4, d.p[2] + ez, 0, rng() * 0.6, (rng() - 0.5) * 0.25);
        }
        if (attached.length) {
          const m = new THREE.Mesh(mergeGeometries(attached),
            new THREE.MeshStandardMaterial({ color: '#4a4854', metalness: 0.1, roughness: 0.95, flatShading: true }));
          m.castShadow = true;
          const deco = this.bldgDeco?.get(d.id);
          (deco || g).add(m);
        }
      }
      if (h % 100 < 46) {
        const chunks = 2 + (h % 4);
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
    const grng = CITY.mulberry32(90210);
    for (let i = 0; i < 50; i++) {
      const x = (grng() - 0.5) * 300;
      const z = (grng() - 0.5) * 300;
      if (Math.hypot(x, z) < 22) continue;
      const cw = 0.8 + grng() * 2.2;
      const ch = 0.5 + grng() * 1.2;
      pushBox(concrete, cw, ch, cw, x, ch / 2, z, (grng() - 0.5) * 0.4, grng() * Math.PI, (grng() - 0.5) * 0.4);
    }
    if (concrete.length) {
      const m = new THREE.Mesh(mergeGeometries(concrete),
        new THREE.MeshStandardMaterial({ color: '#4a4854', metalness: 0.1, roughness: 0.95, flatShading: true }));
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    if (emberChunks.length) {
      const m = new THREE.Mesh(mergeGeometries(emberChunks),
        new THREE.MeshStandardMaterial({ color: '#2a0f04', emissive: new THREE.Color('#ff5a1e'), emissiveIntensity: 1.4, roughness: 0.9 }));
      g.add(m);
    }
  }

  addBillboard(g, d) {
    const grp = new THREE.Group();
    const [bw, bh] = d.size;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.5, bh + 0.5, 0.25),
      new THREE.MeshStandardMaterial({ color: '#1c202c', metalness: 0.7, roughness: 0.5 }));
    grp.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshBasicMaterial({ map: this.cityTex.ads[d.v % 3] }));
    face.position.z = 0.16;
    grp.add(face);
    grp.position.set(...d.p);
    if (d.yaw) grp.rotation.y = d.yaw;
    const deco = d.bldg != null && this.bldgDeco ? this.bldgDeco.get(d.bldg) : null;
    (deco || g).add(grp);
  }

  rebuildBuildingBatches() {
    const g = this.worldGroup;
    for (const m of this.bldgBatchMeshes) { g.remove(m); m.geometry.dispose(); }
    this.bldgBatchMeshes = [];
    const body = {}, roof = {};
    for (const d of this.bldgDefs) {
      if (this.bldgDown.has(d.id)) continue;
      const arch = d.arch || 'concrete';
      const key = arch + '|' + d.color;
      (body[key] = body[key] || []).push(CITY.buildingBodyGeo(d));
      (roof[key] = roof[key] || []).push(CITY.buildingRoofGeo(d));
    }
    const matFor = (key, make) => {
      if (!this.bldgMats.has(key)) this.bldgMats.set(key, make());
      return this.bldgMats.get(key);
    };
    for (const [key, geos] of Object.entries(body)) {
      const [arch, color] = key.split('|');
      const sheets = this.cityTex.facades[arch] || this.cityTex.facades.concrete;
      const mesh = new THREE.Mesh(mergeGeometries(geos),
        matFor('b' + key, () => new THREE.MeshLambertMaterial({
          color, map: sheets.map,
          emissive: new THREE.Color('#ffffff'), emissiveMap: sheets.emissive, emissiveIntensity: 0.85,
          normalMap: this.cityTex.facadeNormal, normalScale: new THREE.Vector2(0.85, 0.85),
        })));
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      this.bldgBatchMeshes.push(mesh);
    }
    for (const [key, geos] of Object.entries(roof)) {
      const [, color] = key.split('|');
      const mesh = new THREE.Mesh(mergeGeometries(geos),
        matFor('r' + key, () => new THREE.MeshLambertMaterial({ color: CITY.shade(color, 0.72) })));
      g.add(mesh);
      this.bldgBatchMeshes.push(mesh);
    }
  }

  collapseBuilding(id, vfx = true) {
    if (!this.bldgDown || this.bldgDown.has(id)) return;
    const d = this.bldgDefs.find((x) => x.id === id);
    if (!d) return;
    this.bldgDown.add(id);
    this.rebuildBuildingBatches();
    const deco = this.bldgDeco.get(id);
    if (deco) this.worldGroup.remove(deco);

    const [w, h, dd] = d.size;
    const rng = CITY.mulberry32(CITY.hashStr('fall' + id));
    const chunks = [];
    const slab = (cw, ch, cd, x, y, z, ry, rz) => {
      const b = new THREE.BoxGeometry(cw, ch, cd);
      b.rotateY(ry); b.rotateZ(rz);
      b.translate(x, y, z);
      chunks.push(b);
    };
    slab(w * 0.6, 1.6 + h * 0.08, dd * 0.6, d.p[0], (1.6 + h * 0.08) / 2, d.p[2], rng() * 1, 0);
    const n = 5 + (CITY.hashStr(id) % 4);
    for (let i = 0; i < n; i++) {
      const cw = 1.5 + rng() * w * 0.4;
      const ch = 0.8 + rng() * 2.2;
      slab(cw, ch, cw * (0.5 + rng() * 0.8),
        d.p[0] + (rng() - 0.5) * w * 0.9, ch / 2, d.p[2] + (rng() - 0.5) * dd * 0.9,
        rng() * Math.PI, (rng() - 0.5) * 0.5);
    }
    const rubble = new THREE.Mesh(mergeGeometries(chunks),
      new THREE.MeshStandardMaterial({ color: '#46434f', roughness: 0.95, metalness: 0.06, flatShading: true }));
    rubble.castShadow = rubble.receiveShadow = true;
    this.worldGroup.add(rubble);

    if (vfx) {
      const p = [d.p[0], 1, d.p[2]];
      this.dust([d.p[0], 7, d.p[2]], 30);
      this.ring(p, '#8b8496', Math.max(w, dd) * 1.4, 0.9);
      for (let i = 0; i < 7; i++) {
        this.smoke([d.p[0] + (Math.random() - 0.5) * w, 2 + Math.random() * h * 0.35,
          d.p[2] + (Math.random() - 0.5) * dd]);
      }
      const nCh = Math.min(12, 6 + Math.round(h / 8));
      for (let i = 0; i < nCh; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 14;
        this.debrisChunk(
          [d.p[0] + (Math.random() - 0.5) * w * 0.7, 2 + Math.random() * h * 0.6, d.p[2] + (Math.random() - 0.5) * dd * 0.7],
          [Math.cos(a) * sp, 4 + Math.random() * 10, Math.sin(a) * sp],
          0.7 + Math.random() * 1.3);
      }
      this.shake(0.65);
    }
  }

  // ------------------------------------------------------ interpolation
  applySample(sample, dt, myMechId) {
    const { a, b, alpha } = sample;

    for (const mb of b.mechs) {
      const ma = a.mechs.find((m) => m.id === mb.id) || mb;
      let view = this.mechViews.get(mb.id);
      if (!view) {
        view = new MechView(this.scene, mb);
        this.mechViews.set(mb.id, view);
      }
      view.apply(ma, mb, alpha, dt);
    }

    const seen = new Set();
    for (const mb of b.monsters || []) {
      seen.add(mb.id);
      const ma = (a.monsters || []).find((m) => m.id === mb.id) || mb;
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

    // tracers + missiles — pooled
    this._weaponPool = this._weaponPool || { tracers: [], missiles: [] };
    this._trPrev = this._trPrev || new Map();
    let ti = 0, mi = 0;
    for (const mb of b.mechs) {
      for (const tr of mb.tracers || []) {
        let mesh = this._weaponPool.tracers[ti];
        if (!mesh) {
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

    // pickups
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
          ring.material.color.set(done ? '#2a9d8f' : '#f5d76e');
          if (!done) ring.rotation.y += dt * 1.5;
        }
      });
      if (this.balloonView) this.balloonView.visible = !b.objectives.balloon;
    }

    this.stepParticles(dt);
  }

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
  // Close over-shoulder combat framing: the mech fills the frame, dynamic
  // FOV punches during sprints and beam fire, and the boom shortens rather
  // than clipping through buildings.
  updateCamera(yaw, pitch, myMechId, dt) {
    const view = this.mechViews.get(myMechId) || this.mechViews.values().next().value;
    let target, wantDist, fovAdd = 0;
    if (view) {
      target = view.root.position.clone();
      target.y += 1.8;                 // chest height — the hull fills the frame
      // shoulder offset in camera space
      const right = new V3(Math.cos(-yaw), 0, Math.sin(-yaw));
      target.addScaledVector(right, 2.3);
      wantDist = this.camDist;
      const mb = view.lastState;
      if (mb) {
        if ((mb.walk || 0) > 5.5) fovAdd += Math.min(8, (mb.walk - 5.5) * 2.2);
        if (mb.laser?.firing) fovAdd -= 5;
        if (mb.kick?.phase === 'swing') fovAdd += 4;
      }
    } else {
      // title orbit
      target = new V3(0, 16, 0);
      wantDist = 42;
      pitch = Math.min(pitch, -0.18);
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = new V3(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    let dist = wantDist;
    // collision: shorten the boom before it enters a building
    if (this.bldgDefs?.length && view) {
      for (let s = 4; s <= dist; s += 2) {
        const px = target.x - dir.x * s, py = target.y - dir.y * s, pz = target.z - dir.z * s;
        if (py < 1.4) { dist = Math.max(4, s - 2); break; }
        let hit = false;
        for (const d of this.bldgDefs) {
          if (this.bldgDown.has(d.id)) continue;
          const [w, h, dd] = d.size;
          if (py < d.p[1] + h / 2 + 1 &&
              Math.abs(px - d.p[0]) < w / 2 + 1.2 &&
              Math.abs(pz - d.p[2]) < dd / 2 + 1.2) { hit = true; break; }
        }
        if (hit) { dist = Math.max(4, s - 2); break; }
      }
    }
    const pos = target.clone().sub(dir.clone().multiplyScalar(dist));
    if (pos.y < 1.3) pos.y = 1.3;
    this.camPos.lerp(pos, Math.min(1, dt * 10));

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

    // character fill rides just above the camera
    this.camFill.position.copy(this.camPos).add(new V3(0, 6, 0));
    this.camFill.target.position.copy(target);

    // dynamic FOV eases toward its target
    this.fovKick += (fovAdd - this.fovKick) * Math.min(1, dt * 6);
    const wantFov = this.fovBase + this.fovKick;
    if (Math.abs(this.camera.fov - wantFov) > 0.1) {
      this.camera.fov = wantFov;
      this.camera.updateProjectionMatrix();
    }

    this.atmo.step(dt, this.camPos, view ? view.root.position : target);
    // searchlights sweep slowly
    const t = performance.now() / 1000;
    for (const s of this.searchlights) {
      s.cone.rotation.z = Math.sin(t * 0.21 + s.ph) * 0.5;
      s.cone.rotation.x = Math.PI + Math.cos(t * 0.17 + s.ph) * 0.35;
    }
    const ep = this.emberPos;
    for (let i = 0; i < ep.length; i += 3) {
      ep[i + 1] += dt * 0.7;
      if (ep[i + 1] > 32) ep[i + 1] = 0.5;
    }
    this.emberPts.geometry.attributes.position.needsUpdate = true;
    this.stepEffects(dt);
  }

  flashMonster(id) {
    this.monsterViews.get(id)?.flash?.();
  }

  // shop hover: preview an upgrade on the live mech before buying
  previewUpgrade(mechId, itemId) {
    const view = this.mechViews.get(mechId) || this.mechViews.values().next().value;
    view?.setPreview(itemId);
  }

  render() { this.composer.render(); }
}

// ===========================================================================
// MECH VIEW — drives the mechfab rig from snapshots.
// Legs: gait with hip/knee/ankle articulation. Arms: two-bone IK with a
// proper elbow. Head: aims with the gunner. Upgrades: visible attachments.
// ===========================================================================
class MechView {
  constructor(scene, mb) {
    this.scene = scene;
    this.buildKey = '';
    this.upKey = '';
    this.previewItem = null;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.rebuild(mb.build || DEFAULT_BUILD, mb.up || {});

    // beam + guide + reticle
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

    this.rocketMeshes = [];
    this.walkPhase = 0;
    this.prevPos = new V3();
    this.velocity = new V3();
    this.armPos = { L: new V3(), R: new V3() };
  }

  rebuild(build, up) {
    const wasAttached = !!this.fab;
    if (this.fab) {
      this.root.remove(this.fab.root);
      this.fab.dispose();
    }
    const effUp = this.effectiveUp(up);
    this.fab = buildMech({ build, up: effUp });
    this.root.add(this.fab.root);
    this.build = build;
    this.up = up;
    this.buildKey = JSON.stringify(build);
    this.upKey = JSON.stringify(up);
    if (!wasAttached) this.root.position.set(0, -100, 0); // below ground until first sample
  }

  effectiveUp(up) {
    if (!this.previewItem) return up;
    const eff = { ...up };
    const it = this.previewItem;
    if (typeof eff[it] === 'number') eff[it] = (eff[it] || 0) + 1;
    else if (it in eff || ['rocket', 'turret', 'dash', 'cannon', 'pods'].includes(it)) eff[it] = true;
    return eff;
  }

  setPreview(itemId) {
    if (this.previewItem === itemId) return;
    this.previewItem = itemId;
    this.fab?.setUpgrades(this.effectiveUp(this.up || {}));
  }

  dispose(scene) {
    scene.remove(this.root, this.beam, this.beamSheath, this.beamGlow, this.guide, this.reticle);
    this.fab?.dispose();
    for (const m of this.rocketMeshes) scene.remove(m);
  }

  apply(ma, mb, alpha, dt) {
    this.lastState = mb;
    // structural changes: hangar build or purchased upgrades
    const bk = JSON.stringify(mb.build || null);
    if (mb.build && bk !== this.buildKey) this.rebuild(mb.build, mb.up || {});
    else {
      const uk = JSON.stringify(mb.up || {});
      if (uk !== this.upKey) {
        this.upKey = uk;
        this.up = mb.up || {};
        this.fab.setUpgrades(this.effectiveUp(this.up));
      }
    }

    this.root.position.set(
      lerp(ma.p[0], mb.p[0], alpha), lerp(ma.p[1], mb.p[1], alpha), lerp(ma.p[2], mb.p[2], alpha));
    const qa = new THREE.Quaternion(...ma.q), qb = new THREE.Quaternion(...mb.q);
    this.root.quaternion.copy(qa.slerp(qb, alpha));

    if (dt > 0) {
      this.velocity.copy(this.root.position).sub(this.prevPos).divideScalar(Math.max(dt, 1e-4));
      this.prevPos.copy(this.root.position);
    }

    const N = this.fab.nodes;

    // ---- head aims with the gunner ----
    const bodyYaw = getYaw(this.root.quaternion);
    let rel = (mb.head.yaw ?? 0) - bodyYaw;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    N.head.rotation.y += (clampN(rel, 1.15) - N.head.rotation.y) * 0.25;
    N.head.rotation.x += (clampN(-(mb.head.pitch ?? 0), 0.6) - N.head.rotation.x) * 0.25;
    // slight chest twist toward the aim: upper body leads, hips follow
    N.chest.rotation.y += (clampN(rel * 0.25, 0.3) - N.chest.rotation.y) * 0.12;

    // ---- eye charge ----
    const charge = mb.laser.charge || 0;
    const chargeScale = 1 + charge * 1.8 + (mb.laser.firing ? 1.1 : 0);
    N.eye.scale.setScalar(chargeScale + (charge > 0 ? Math.random() * 0.25 : 0));
    N.eye.material.color.set(mb.laser.firing ? '#ffffff' : charge > 0 ? '#e08cff' : (this.build.paint?.emissive || '#3fd6ff'));

    // ---- legs ----
    const kick = mb.kick;
    if (mb.ragdoll || mb.dead) {
      this.poseLegsRag(dt);
    } else if (kick.phase !== 'idle') {
      this.poseKick(kick, dt);
    } else {
      this.walkPhase += (mb.walk || 0) * dt * 0.66;
      const swing = Math.min(1, (mb.walk || 0) / 3.4) * 0.62;
      for (const S of ['L', 'R']) {
        const ph = this.walkPhase + (S === 'L' ? 0 : Math.PI);
        const hip = N['hip' + S], shin = N['shin' + S], foot = N['foot' + S];
        const hipRot = Math.sin(ph) * swing;
        const kneeRot = Math.max(0, -Math.sin(ph + 0.9)) * swing * 1.15;
        hip.rotation.x = damp(hip.rotation.x, hipRot, 12, dt);
        shin.rotation.x = damp(shin.rotation.x, kneeRot, 12, dt);
        // ankle keeps the sole level with the street
        foot.rotation.x = damp(foot.rotation.x, -(hipRot + kneeRot) * 0.75, 12, dt);
      }
      // torso settles: subtle counter-bob with the gait
      N.chest.position.y = Math.abs(Math.sin(this.walkPhase)) * -0.08 * Math.min(1, (mb.walk || 0) / 4);
    }

    // ---- arms: two-bone IK ----
    for (const side of ['L', 'R']) this.poseArm(side, mb, dt);

    // ---- laser beam + targeting guide ----
    this.root.updateMatrixWorld();
    const eyeWorld = new V3(0, 0.1, -0.8).applyMatrix4(N.head.matrixWorld);
    if (mb.laser.firing && mb.laser.from && mb.laser.to) {
      const from = eyeWorld, to = new V3(...mb.laser.to);
      placeSegment(this.beam, from, to);
      placeSegment(this.beamSheath, from, to);
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
      if (mb.laser.aim && !mb.ragdoll && !mb.dead) {
        const to = new V3(...mb.laser.aim);
        placeSegment(this.guide, eyeWorld, to);
        const gw = 1 + charge * 5;
        this.guide.scale.x = gw; this.guide.scale.z = gw;
        this.guide.material.opacity = 0.2 + charge * 0.6;
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

    // ---- flying rocket fists ----
    const rockets = mb.rockets || [];
    while (this.rocketMeshes.length < rockets.length) {
      const grp = new THREE.Group();
      const fist = new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.1, 1.3, 2, 0.16), this.fab.mats.panel);
      grp.add(fist);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 8),
        new THREE.MeshBasicMaterial({ color: '#ffb066' }));
      flame.position.z = 1.2;
      flame.rotation.x = -Math.PI / 2;
      grp.add(flame);
      this.scene.add(grp);
      this.rocketMeshes.push(grp);
    }
    this.rocketMeshes.forEach((m, i) => {
      const r = rockets[i];
      m.visible = !!r;
      if (r) {
        m.position.set(...r.p);
        m.rotation.y += dt * 9;
      }
    });

    // ragdoll / death lean
    if (mb.ragdoll || mb.dead) {
      N.chest.rotation.x = damp(N.chest.rotation.x, 0.25, 4, dt);
    } else {
      N.chest.rotation.x = damp(N.chest.rotation.x, 0, 6, dt);
    }
  }

  // two-bone IK: shoulder -> elbow -> wrist with an outward pole vector
  poseArm(side, mb, dt) {
    const N = this.fab.nodes;
    const st = mb.arms[side];
    const P = MECH.punch;
    const s = side === 'L' ? -1 : 1;
    const bones = this.fab.root.userData.bones;

    const shoulderNode = N['upperArm' + side];
    shoulderNode.parent.updateMatrixWorld();
    const shoulder = new V3().setFromMatrixPosition(shoulderNode.matrixWorld);

    const aim = new V3(
      -Math.sin(st.yaw) * Math.cos(st.pitch),
      Math.sin(st.pitch),
      -Math.cos(st.yaw) * Math.cos(st.pitch)
    );
    const sideDir = new V3(-aim.z, 0, aim.x).normalize().multiplyScalar(s * 1.2);

    let target;
    if (mb.ragdoll || mb.dead) {
      target = shoulder.clone().add(new V3(s * 1.6, -2.6, 0.5));
    } else if (st.phase === 'windup') {
      const k = Math.min(1, st.t / P.windup);
      target = shoulder.clone().addScaledVector(aim, -1.8 * k).add(sideDir).add(new V3(0, 0.6 * k, 0));
    } else if (st.phase === 'swing') {
      const k = Math.min(1, st.t / P.swing);
      target = shoulder.clone().addScaledVector(aim, -1.8 + (P.range * 0.92 + 1.8) * ease(k)).add(sideDir.clone().multiplyScalar(1 - k * 0.7));
    } else if (st.phase === 'recover') {
      const k = Math.min(1, st.t / P.recover);
      target = shoulder.clone().addScaledVector(aim, P.range * 0.92 * (1 - ease(k))).add(sideDir);
      target.y -= ease(k) * 2.0;
    } else {
      const sway = Math.sin(performance.now() / 700 + s) * 0.2;
      target = shoulder.clone()
        .add(new V3(0, -3.3 + sway, -0.3).applyQuaternion(this.root.quaternion))
        .add(new V3(s * 0.75, 0, 0).applyQuaternion(this.root.quaternion));
    }

    const pos = this.armPos[side];
    pos.lerp(target, Math.min(1, dt * (st.phase === 'swing' ? 40 : 14)));

    // clamp to reach
    const a = bones.upperLen, b2 = bones.foreLen + 0.9; // wrist->fist adds reach
    const toT = pos.clone().sub(shoulder);
    let c = toT.length();
    if (c > a + b2 - 0.05) { toT.multiplyScalar((a + b2 - 0.05) / c); c = a + b2 - 0.05; pos.copy(shoulder).add(toT); }
    if (c < 0.8) { toT.normalize().multiplyScalar(0.8); c = 0.8; pos.copy(shoulder).add(toT); }

    // elbow position via law of cosines; pole pushes elbows out + back
    const cosA = Math.max(-1, Math.min(1, (a * a + c * c - b2 * b2) / (2 * a * c)));
    const proj = a * cosA;
    const h = Math.sqrt(Math.max(0, a * a - proj * proj));
    const dirN = toT.clone().normalize();
    const poleRaw = new V3(s * 1.0, -0.25, 0.55).applyQuaternion(this.root.quaternion);
    const pole = poleRaw.sub(dirN.clone().multiplyScalar(poleRaw.dot(dirN))).normalize();
    const elbow = shoulder.clone().addScaledVector(dirN, proj).addScaledVector(pole, h);

    orientSegment(shoulderNode, shoulder, elbow);
    shoulderNode.updateMatrixWorld();      // refresh before reading the elbow point
    const foreNode = N['foreArm' + side];
    const elbowW = new V3().setFromMatrixPosition(foreNode.matrixWorld);
    orientSegment(foreNode, elbowW, pos);
    foreNode.updateMatrixWorld();

    // fist orientation follows the body, knuckles forward
    const fist = N['fist' + side];
    const pq = new THREE.Quaternion();
    fist.parent.getWorldQuaternion(pq);
    fist.quaternion.copy(pq.invert()).multiply(this.root.quaternion);
  }

  poseKick(kick, dt) {
    const N = this.fab.nodes;
    const K = MECH.kick;
    const planted = { hip: N.hipL, shin: N.shinL, foot: N.footL };
    const kicker = { hip: N.hipR, shin: N.shinR, foot: N.footR };
    if (kick.phase === 'windup') {
      const k = Math.min(1, kick.t / K.windup);
      kicker.hip.rotation.x = 0.7 * k;
      kicker.shin.rotation.x = 1.15 * k;
      kicker.foot.rotation.x = -0.4 * k;
      planted.hip.rotation.x = -0.15 * k;
    } else if (kick.phase === 'swing') {
      const k = Math.min(1, kick.t / K.swing);
      kicker.hip.rotation.x = 0.7 - 2.1 * ease(k);
      kicker.shin.rotation.x = 1.15 - 1.05 * ease(k);
      kicker.foot.rotation.x = -0.4 + 0.6 * ease(k);
    } else {
      const k = Math.min(1, kick.t / K.recover);
      kicker.hip.rotation.x = -1.4 * (1 - ease(k));
      kicker.shin.rotation.x = 0.1 * (1 - ease(k));
      kicker.foot.rotation.x = 0.2 * (1 - ease(k));
      planted.hip.rotation.x = -0.15 * (1 - ease(k));
    }
  }

  poseLegsRag(dt) {
    const N = this.fab.nodes;
    N.hipL.rotation.x = damp(N.hipL.rotation.x, 1.7, 6, dt);
    N.hipR.rotation.x = damp(N.hipR.rotation.x, -1.2, 6, dt);
    N.shinL.rotation.x = damp(N.shinL.rotation.x, 0.8, 6, dt);
    N.shinR.rotation.x = damp(N.shinR.rotation.x, 1.2, 6, dt);
  }
}

// ---------------------------------------------------------------- helpers
let _roundSprite = null;
function roundSprite() {
  if (_roundSprite) return _roundSprite;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  _roundSprite = new THREE.CanvasTexture(cv);
  return _roundSprite;
}

function makeCarMesh(d) {
  const car = new THREE.Group();
  const [w, h, dp] = d.size;
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(w, h * 0.55, dp, 3, 0.18),
    new THREE.MeshStandardMaterial({ color: d.color, metalness: 0.75, roughness: 0.3, envMapIntensity: 1.2 })
  );
  body.position.y = 0.1;
  body.castShadow = true;
  car.add(body);
  const cabin = new THREE.Mesh(
    new RoundedBoxGeometry(w * 0.5, h * 0.45, dp * 0.82, 2, 0.14),
    new THREE.MeshStandardMaterial({ color: '#0e1a26', metalness: 0.4, roughness: 0.12, envMapIntensity: 1.5 })
  );
  cabin.position.set(-w * 0.06, h * 0.42, 0);
  car.add(cabin);
  const wheelG = new THREE.CylinderGeometry(h * 0.28, h * 0.28, 0.24, 10);
  const wheelM = new THREE.MeshStandardMaterial({ color: '#15161c', metalness: 0.3, roughness: 0.8 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wh = new THREE.Mesh(wheelG, wheelM);
    wh.rotation.x = Math.PI / 2;
    wh.position.set(sx * w * 0.32, -h * 0.18, sz * (dp / 2 - 0.02));
    car.add(wh);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.4),
    new THREE.MeshBasicMaterial({ color: '#ffeebb' }));
  head.position.set(w / 2 - 0.02, 0.12, 0);
  head.scale.z = dp * 1.4;
  car.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.36),
    new THREE.MeshBasicMaterial({ color: '#ff4444' }));
  tail.position.set(-w / 2 + 0.02, 0.12, 0);
  tail.scale.z = dp * 1.4;
  car.add(tail);
  return car;
}

// orient a -Y-built limb segment so its -Y axis runs from `from` to `to`
const _oq = new THREE.Quaternion();
const _ov = new V3();
function orientSegment(node, from, to) {
  const dir = _ov.copy(to).sub(from);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  const parentQ = new THREE.Quaternion();
  node.parent.getWorldQuaternion(parentQ);
  const localDir = dir.applyQuaternion(parentQ.invert());
  node.quaternion.setFromUnitVectors(new V3(0, -1, 0), localDir);
}

function placeSegment(mesh, a, b, radiusScale = 1) {
  const dir = b.clone().sub(a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(radiusScale, len, radiusScale);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
}

function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function clampN(n, m) { return Math.max(-m, Math.min(m, n)); }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function damp(cur, target, speed, dt) { return cur + (target - cur) * Math.min(1, speed * dt); }
function getYaw(q) {
  const fwd = new V3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-fwd.x, -fwd.z);
}
