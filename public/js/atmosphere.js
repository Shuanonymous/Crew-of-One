import * as THREE from 'three';

// ===========================================================================
// ATMOSPHERE — deliberate sky/weather/light pipeline.
//
// A weather state machine drifts through fronts during a run: storm, rain,
// overcast, clear night, golden hour, cold dawn. Each state drives the sky
// gradient, fog, key/rim/fill lights, cloud deck, rain density, and
// lightning cadence, crossfaded over ~8 s so fronts ROLL IN rather than pop.
//
// Rain is fine instanced streaks (crossed-quad instances — readable from
// every angle, never giant squares), density-limited near the camera.
// ===========================================================================

const V3 = THREE.Vector3;

export const WEATHERS = {
  storm: {
    sky: ['#05070f', '#0b1120', '#151d33', '#232741'], fog: '#111726', fogFar: 300,
    hemi: ['#6d7ea6', '#151827'], hemiI: 0.85,
    key: '#9fb4e8', keyI: 1.6, keyPos: [-70, 90, -40],
    rim: '#4d6aa6', rimI: 0.9, fill: '#3d4668', fillI: 0.3,
    rain: 1.0, wind: 1.0, lightning: 9, clouds: 0.9, stars: 0, moon: 0,
  },
  rain: {
    sky: ['#0a0e1a', '#131a2e', '#1f2740', '#33344f'], fog: '#161c2e', fogFar: 340,
    hemi: ['#8b9cc4', '#1a1d30'], hemiI: 1.2,
    key: '#b8c8ee', keyI: 1.8, keyPos: [-60, 80, -30],
    rim: '#5d7ab8', rimI: 1.0, fill: '#6b5d55', fillI: 0.35,
    rain: 0.55, wind: 0.55, lightning: 26, clouds: 0.7, stars: 0, moon: 0.25,
  },
  overcast: {
    sky: ['#141926', '#232a3d', '#39415c', '#565a75'], fog: '#272e42', fogFar: 400,
    hemi: ['#a7b4d4', '#242737'], hemiI: 1.15,
    key: '#ccd6ee', keyI: 1.9, keyPos: [-40, 95, 20],
    rim: '#7d90bb', rimI: 0.8, fill: '#8a7a68', fillI: 0.4,
    rain: 0.0, wind: 0.35, lightning: 0, clouds: 0.55, stars: 0, moon: 0.15,
  },
  clearNight: {
    sky: ['#040613', '#0a0f24', '#141b38', '#25294d'], fog: '#0e1326', fogFar: 480,
    hemi: ['#93a5d6', '#131629'], hemiI: 1.05,
    key: '#cfdcff', keyI: 2.2, keyPos: [-80, 70, -50],
    rim: '#6d86c9', rimI: 1.1, fill: '#a08055', fillI: 0.45,
    rain: 0, wind: 0.2, lightning: 0, clouds: 0.12, stars: 1, moon: 1,
  },
  golden: {
    sky: ['#3f5a96', '#7a6da8', '#d88a6a', '#f3b45f'], fog: '#c98a6d', fogFar: 460,
    hemi: ['#ffe2bb', '#5d5478'], hemiI: 1.0,
    key: '#ffc27d', keyI: 2.4, keyPos: [85, 30, 35],
    rim: '#8aa5ff', rimI: 0.9, fill: '#ff9a5c', fillI: 0.5,
    rain: 0, wind: 0.25, lightning: 0, clouds: 0.28, stars: 0, moon: 0, sunDisc: 1,
  },
  dawn: {
    sky: ['#2a4a75', '#5e7fa8', '#c9a98f', '#f1d9a8'], fog: '#a3958b', fogFar: 430,
    hemi: ['#f5ead0', '#4d5878'], hemiI: 0.95,
    key: '#ffedc2', keyI: 1.9, keyPos: [-85, 26, 45],
    rim: '#7a94cc', rimI: 0.8, fill: '#d8b088', fillI: 0.4,
    rain: 0.12, wind: 0.3, lightning: 0, clouds: 0.35, stars: 0, moon: 0, sunDisc: 0.7,
  },
};
const CYCLE = ['storm', 'rain', 'overcast', 'clearNight', 'golden', 'dawn'];

const RAIN_N = 1100;

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;

    // sky gradient
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2; this.skyCanvas.height = 512;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.skyTex;
    scene.fog = new THREE.Fog('#161c2e', 60, 340);

    // light rig: floor ambient (never crush to black), hemisphere, key
    // (sun/moon, shadowed), cool rim, warm fill
    this.scene.add(new THREE.AmbientLight('#2a3350', 0.5));
    this.hemi = new THREE.HemisphereLight('#8b9cc4', '#1a1d30', 0.7);
    scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#b8c8ee', 1.3);
    this.key.position.set(-60, 80, -30);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const S = 90;
    this.key.shadow.camera.left = -S; this.key.shadow.camera.right = S;
    this.key.shadow.camera.top = S; this.key.shadow.camera.bottom = -S;
    this.key.shadow.camera.far = 500;
    this.key.shadow.bias = -0.0004;
    scene.add(this.key, this.key.target);
    this.rim = new THREE.DirectionalLight('#5d7ab8', 1.0);
    this.rim.position.set(-50, 40, 60);
    scene.add(this.rim);
    this.fill = new THREE.DirectionalLight('#6b5d55', 0.35);
    this.fill.position.set(55, 25, 45);
    scene.add(this.fill);

    // moon disc + sun disc (either shows per weather)
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(22, 40),
      new THREE.MeshBasicMaterial({ color: '#e8eeff', fog: false, transparent: true, opacity: 0.9 }));
    this.moon.position.set(-420, 250, -260);
    this.moon.lookAt(0, 0, 0);
    scene.add(this.moon);
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(55, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd9a0', fog: false, transparent: true, opacity: 0 }));
    this.sunDisc.position.set(430, 65, 170);
    this.sunDisc.lookAt(0, 0, 0);
    scene.add(this.sunDisc);

    // stars
    const starN = 320, starPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.12 + Math.random() * 1.3;
      const r = 700;
      starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      starPos[i * 3 + 1] = Math.sin(e) * r * 0.6 + 60;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: '#cdd8ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false,
      map: roundSpriteTex(), depthWrite: false,
    }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // cloud deck: two big scrolling noise planes at different heights/speeds
    this.cloudTex = makeCloudTexture();
    this.clouds = [];
    for (const [h, sc, sp] of [[150, 900, 1.6], [190, 1300, 0.9]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sc, sc),
        new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.6, depthWrite: false, fog: false, color: '#3a4155' }));
      m.rotation.x = Math.PI / 2;
      m.position.y = h;
      m.material.map = this.cloudTex.clone();
      m.material.map.wrapS = m.material.map.wrapT = THREE.RepeatWrapping;
      m.material.map.repeat.set(2.2, 2.2);
      scene.add(m);
      this.clouds.push({ m, sp });
    }

    // RAIN — instanced crossed-quad streaks (thin, elongated, wind-sheared)
    const streak = mergeQuads();
    this.rainMat = new THREE.MeshBasicMaterial({
      color: '#9db2d8', transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rain = new THREE.InstancedMesh(streak, this.rainMat, RAIN_N);
    this.rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.drops = [];
    for (let i = 0; i < RAIN_N; i++) {
      this.drops.push({
        x: (Math.random() - 0.5) * 160, y: Math.random() * 70, z: (Math.random() - 0.5) * 160,
        s: 0.7 + Math.random() * 0.9,
      });
    }
    this._dummy = new THREE.Object3D();
    this.rainCount = RAIN_N;

    // lightning bolt mesh (rebuilt per strike)
    this.bolt = null;
    this.flash = 0;
    this.lightningT = 12;
    this.thunderReady = false;

    // weather machine
    this.cur = { ...WEATHERS.rain };
    this.from = { ...WEATHERS.rain };
    this.to = WEATHERS.rain;
    this.blend = 1;
    this.holdT = 30 + Math.random() * 40;
    this.auto = true;
    this.weatherName = 'rain';
    this.qualityMul = 1;
    this.applyBlend();
  }

  setQuality(q) {
    this.qualityMul = q === 'low' ? 0.4 : q === 'medium' ? 0.8 : 1;
    this.rainCount = Math.floor(RAIN_N * this.qualityMul);
  }

  setWeather(name, instant = false) {
    if (name === 'auto') { this.auto = true; return; }
    if (!WEATHERS[name]) return;
    this.auto = false;
    this.startTransition(name);
    if (instant) { this.blend = 1; this.applyBlend(); }
  }

  startTransition(name) {
    this.from = { ...this.cur };
    this.to = WEATHERS[name];
    this.weatherName = name;
    this.blend = 0;
  }

  // random front roughly once a minute; storms slightly favored at night
  stepMachine(dt) {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 8);
      this.applyBlend();
    } else if (this.auto) {
      this.holdT -= dt;
      if (this.holdT <= 0) {
        this.holdT = 45 + Math.random() * 45;
        const options = CYCLE.filter((w) => w !== this.weatherName);
        this.startTransition(options[Math.floor(Math.random() * options.length)]);
      }
    }
  }

  applyBlend() {
    const t = smooth(this.blend), a = this.from, b = this.to, c = this.cur;
    const mixC = (x, y) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
    c.sky = a.sky.map((col, i) => mixC(col, b.sky[i]));
    c.fog = mixC(a.fog, b.fog);
    for (const k of ['fogFar', 'hemiI', 'keyI', 'rimI', 'fillI', 'rain', 'wind', 'lightning', 'clouds', 'stars', 'moon', 'sunDisc']) {
      c[k] = lerp(a[k] || 0, b[k] || 0, t);
    }
    c.hemi = [mixC(a.hemi[0], b.hemi[0]), mixC(a.hemi[1], b.hemi[1])];
    c.key = mixC(a.key, b.key);
    c.rim = mixC(a.rim, b.rim);
    c.fill = mixC(a.fill, b.fill);
    c.keyPos = a.keyPos.map((v, i) => lerp(v, b.keyPos[i], t));

    // paint the sky
    const ctx = this.skyCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, c.sky[0]);
    grad.addColorStop(0.42, c.sky[1]);
    grad.addColorStop(0.72, c.sky[2]);
    grad.addColorStop(1, c.sky[3]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);
    this.skyTex.needsUpdate = true;

    this.scene.fog.color.set(c.fog);
    this.fogBase = c.fogFar * (this.fogScale || 1);
    this.hemi.color.set(c.hemi[0]); this.hemi.groundColor.set(c.hemi[1]); this.hemi.intensity = c.hemiI;
    this.key.color.set(c.key); this.key.intensity = c.keyI;
    this.key.position.set(...c.keyPos);
    this.rim.color.set(c.rim); this.rim.intensity = c.rimI;
    this.fill.color.set(c.fill); this.fill.intensity = c.fillI;
    this.stars.material.opacity = c.stars * 0.9;
    this.moon.material.opacity = c.moon * 0.95;
    this.sunDisc.material.opacity = (c.sunDisc || 0) * 0.95;
    for (const cl of this.clouds) cl.m.material.opacity = c.clouds * 0.55;
  }

  step(dt, camPos, shadowTarget) {
    this.stepMachine(dt);
    const c = this.cur;
    const t = performance.now() / 1000;

    // shadow camera follows the action so shadows stay crisp near the mech
    if (shadowTarget) {
      this.key.target.position.copy(shadowTarget);
      this.key.position.set(shadowTarget.x + c.keyPos[0], c.keyPos[1], shadowTarget.z + c.keyPos[2]);
    }

    // wind gusts breathe
    const gust = Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.047 + 2) * 0.4;
    const windX = gust * 26 * c.wind;

    // fog breathes with the gusts
    if (this.scene.fog && this.fogBase) this.scene.fog.far = this.fogBase * (1 - Math.abs(gust) * 0.1);

    // ---- rain streaks ----
    const active = Math.floor(this.rainCount * c.rain);
    const d = this._dummy;
    const fall = 46 + Math.abs(gust) * 16;
    const tilt = Math.atan2(windX, fall);
    for (let i = 0; i < active; i++) {
      const p = this.drops[i];
      p.x += windX * dt;
      p.y -= fall * dt * p.s;
      if (p.y < 0.2) {
        p.x = camPos.x + (Math.random() - 0.5) * 150;
        p.y = 45 + Math.random() * 25;
        p.z = camPos.z + (Math.random() - 0.5) * 150;
      }
      // fade very-near drops: reposition anything closer than 6 m to the camera
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      if (dx * dx + dz * dz < 30 && Math.abs(p.y - camPos.y) < 5) { p.x += 9; p.z += 9; }
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(0, 0, -tilt);
      d.scale.set(1, p.s * (0.8 + c.wind * 0.5), 1);
      d.updateMatrix();
      this.rain.setMatrixAt(i, d.matrix);
    }
    // park the unused instances out of sight
    if (this._lastActive !== active) {
      d.position.set(0, -500, 0); d.scale.setScalar(0.001); d.updateMatrix();
      for (let i = active; i < RAIN_N; i++) this.rain.setMatrixAt(i, d.matrix);
      this._lastActive = active;
    }
    this.rain.instanceMatrix.needsUpdate = true;
    this.rainMat.opacity = 0.22 + c.rain * 0.2 + Math.abs(gust) * 0.08;
    this.rain.visible = active > 0;

    // ---- clouds scroll ----
    for (const cl of this.clouds) {
      cl.m.material.map.offset.x += dt * 0.004 * cl.sp * (0.5 + c.wind);
      cl.m.position.x = camPos.x; cl.m.position.z = camPos.z;
    }
    this.stars.rotation.y += dt * 0.004;

    // ---- lightning ----
    if (c.lightning > 0) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = c.lightning * (0.6 + Math.random());
        this.strike(camPos);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      this.hemi.intensity = this.cur.hemiI + this.flash * 2.2;
      if (this.bolt) this.bolt.material.opacity = this.flash;
      if (this.flash === 0 && this.bolt) { this.scene.remove(this.bolt); this.bolt.geometry.dispose(); this.bolt = null; }
    }
    if (this.thunderT != null) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) { this.thunderT = null; this.thunderReady = true; }
    }
  }

  strike(camPos) {
    this.flash = 1;
    this.thunderT = 0.5 + Math.random() * 1.6;
    // a real jagged bolt on the horizon
    const a = Math.random() * Math.PI * 2;
    const dist = 260 + Math.random() * 160;
    const bx = camPos.x + Math.cos(a) * dist, bz = camPos.z + Math.sin(a) * dist;
    const pts = [];
    let x = bx, y = 220 + Math.random() * 60, z = bz;
    while (y > 0) {
      pts.push(new V3(x, y, z));
      x += (Math.random() - 0.5) * 22;
      z += (Math.random() - 0.5) * 22;
      y -= 18 + Math.random() * 26;
    }
    pts.push(new V3(x, 0, z));
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.9, 4);
    if (this.bolt) { this.scene.remove(this.bolt); this.bolt.geometry.dispose(); }
    this.bolt = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#eaf0ff', transparent: true, opacity: 1, fog: false }));
    this.scene.add(this.bolt);
  }

  dispose() {
    // scene-lifetime object; nothing dynamic beyond the bolt
    if (this.bolt) { this.scene.remove(this.bolt); this.bolt.geometry.dispose(); }
  }
}

// two crossed elongated quads — reads as a streak from any camera angle
function mergeQuads() {
  const g1 = new THREE.PlaneGeometry(0.035, 1.35);
  const g2 = g1.clone();
  g2.rotateY(Math.PI / 2);
  const g = mergeGeo(g1, g2);
  return g;
}
function mergeGeo(a, b) {
  const pos = new Float32Array(a.attributes.position.count * 3 + b.attributes.position.count * 3);
  pos.set(a.attributes.position.array, 0);
  pos.set(b.attributes.position.array, a.attributes.position.count * 3);
  const idx = [];
  for (let i = 0; i < a.index.count; i++) idx.push(a.index.getX(i));
  for (let i = 0; i < b.index.count; i++) idx.push(b.index.getX(i) + a.attributes.position.count);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function makeCloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  // layered soft blobs = value-noise-ish cloud mass
  for (let pass = 0; pass < 3; pass++) {
    const n = [26, 60, 130][pass];
    const r = [60, 28, 10][pass];
    const al = [0.05, 0.05, 0.06][pass];
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${al})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // wrap blobs for seamless tiling
      if (x < r) { ctx.fillRect(x - r + 256, y - r, r * 2, r * 2); }
      if (y < r) { ctx.fillRect(x - r, y - r + 256, r * 2, r * 2); }
    }
  }
  return new THREE.CanvasTexture(cv);
}

let _rs = null;
function roundSpriteTex() {
  if (_rs) return _rs;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  _rs = new THREE.CanvasTexture(cv);
  return _rs;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
