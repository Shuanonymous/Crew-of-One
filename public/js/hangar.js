import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildMech } from '/js/mechfab.js';

// ===========================================================================
// HANGAR — the pre-run customization bay.
//
// A full-screen 3D preview of the crew's shared mech inside a lit gantry
// hangar: deck plating, hazard ring, scaffold cranes, work lights, drifting
// steam, human-scale deck crew for size. Drag orbits, wheel zooms, and the
// UI can pulse-highlight whichever component layer is being edited.
// ===========================================================================

const V3 = THREE.Vector3;

const HIGHLIGHT_NODE = {
  frame: 'chest', head: 'head', torso: 'chest',
  armL: 'foreArmL', armR: 'foreArmR', legs: 'shinL',
  shoulderL: 'sockL', shoulderR: 'sockR', armorKit: 'chest',
};

export class Hangar {
  constructor(glRenderer, canvas) {
    this.gl = glRenderer;
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#07090f');
    this.scene.fog = new THREE.Fog('#0a0d16', 24, 130);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.yaw = 0.65;
    this.pitch = 0.1;
    this.dist = 20;
    this.focusY = 6.8;

    // metals need an environment to read as metal — small PMREM env
    try {
      const pmrem = new THREE.PMREMGenerator(glRenderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color('#141a26');
      const top = new THREE.Mesh(new THREE.SphereGeometry(40, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#3d4a66', side: THREE.BackSide }));
      envScene.add(top);
      const l1 = new THREE.PointLight('#dfe8ff', 60, 200); l1.position.set(15, 25, 10); envScene.add(l1);
      const l2 = new THREE.PointLight('#ffb066', 45, 200); l2.position.set(-18, 12, -6); envScene.add(l2);
      this.scene.environment = pmrem.fromScene(envScene).texture;
    } catch (e) { /* no PMREM: lit-only */ }

    // ---- light rig: cool ambient, two hot work keys, warm bounce ----
    this.scene.add(new THREE.AmbientLight('#39435c', 0.65));
    this.scene.add(new THREE.HemisphereLight('#7d8fb6', '#181b26', 0.9));
    const key = new THREE.SpotLight('#dfe8ff', 2600, 120, 0.65, 0.45);
    key.position.set(14, 26, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);
    const amber = new THREE.SpotLight('#ffb066', 1400, 100, 0.75, 0.5);
    amber.position.set(-16, 18, -8);
    this.scene.add(amber, amber.target);
    const rim = new THREE.DirectionalLight('#4d7dff', 1.6);
    rim.position.set(-8, 12, -22);
    this.scene.add(rim);

    this.buildRoom();

    this.fab = null;
    this.buildKey = '';
    this.hlMesh = null;
    this.hlT = 0;
    this.steam = [];
    for (let i = 0; i < 5; i++) this.spawnSteam(true);

    this.active = false;
    this.dragging = false;
    this._down = (e) => { if (this.active && !e.target.closest?.('.hg-panel')) { this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; } };
    this._move = (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lx) * 0.006;
      this.pitch = Math.max(-0.35, Math.min(0.9, this.pitch + (e.clientY - this.ly) * 0.004));
      this.lx = e.clientX; this.ly = e.clientY;
    };
    this._up = () => { this.dragging = false; };
    this._wheel = (e) => {
      if (!this.active || e.target.closest?.('.hg-panel')) return;
      this.dist = Math.max(7, Math.min(30, this.dist + Math.sign(e.deltaY) * 1.4));
    };
    window.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('wheel', this._wheel, { passive: true });
  }

  buildRoom() {
    // deck plating
    const deckTex = makeDeckTexture();
    deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
    deckTex.repeat.set(12, 12);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(70, 48),
      new THREE.MeshStandardMaterial({ color: '#3d434f', map: deckTex, metalness: 0.6, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // hazard ring under the mech
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.2, 7.4, 64),
      new THREE.MeshBasicMaterial({ color: '#d8a03c', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.scene.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(7.5, 7.65, 64),
      new THREE.MeshBasicMaterial({ color: '#3fd6ff', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.03;
    this.scene.add(ring2);

    // gantry towers + cross beams (merged truss boxes)
    const truss = [];
    const beam = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      truss.push(g);
    };
    for (const s of [-1, 1]) {
      beam(1.4, 22, 1.4, s * 13, 11, -6);
      beam(1.4, 22, 1.4, s * 13, 11, 6);
      beam(1.4, 1.2, 14, s * 13, 20, 0);
      beam(1.2, 1.2, 14, s * 13, 9.5, 0);
      // sliding work platforms
      beam(3.6, 0.4, 2.6, s * 11.6, 12.5, 5.2);
      beam(3.6, 0.4, 2.6, s * 11.6, 7.5, -5.4);
    }
    beam(28, 1.6, 1.6, 0, 21.5, -6);
    beam(28, 1.6, 1.6, 0, 21.5, 6);
    const trussMesh = new THREE.Mesh(mergeGeometries(truss),
      new THREE.MeshStandardMaterial({ color: '#2c3038', metalness: 0.7, roughness: 0.5 }));
    trussMesh.castShadow = true;
    this.scene.add(trussMesh);

    // work light panels on the cross beams
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8),
        new THREE.MeshBasicMaterial({ color: '#eaf0ff' }));
      lamp.position.set(x, 21, z * 0.98);
      lamp.rotation.x = z < 0 ? 0.6 : -0.6 + Math.PI;
      this.scene.add(lamp);
    }
    // amber wall floods
    for (const s of [-1, 1]) {
      const flood = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6),
        new THREE.MeshBasicMaterial({ color: '#ffb066' }));
      flood.position.set(s * 12.9, 18, 0);
      flood.rotation.y = -s * Math.PI / 2;
      this.scene.add(flood);
    }

    // back wall panels with a big painted bay number
    const wallTex = makeWallTexture();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(48, 48, 40, 32, 1, true, Math.PI * 0.65, Math.PI * 1.7),
      new THREE.MeshStandardMaterial({ color: '#1a1e28', map: wallTex, metalness: 0.4, roughness: 0.8, side: THREE.BackSide }));
    wall.position.y = 18;
    this.scene.add(wall);

    // human-scale deck crew (1.8 m silhouettes) — the scale cue that matters
    const crewMat = new THREE.MeshStandardMaterial({ color: '#c9a03c', roughness: 0.8 });
    const visMat = new THREE.MeshBasicMaterial({ color: '#9adfff' });
    for (const [x, z, ry] of [[7.5, 4.5, -0.7], [-6.8, 5.6, 0.5], [4.6, -6.4, 2.6]]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.05, 3, 8), crewMat);
      body.position.y = 0.95;
      g.add(body);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), crewMat);
      helm.position.y = 1.72;
      g.add(helm);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), visMat);
      visor.position.set(0, 1.72, -0.14);
      g.add(visor);
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      this.scene.add(g);
    }
  }

  spawnSteam(seedTime = false) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random(), 7, 6),
      new THREE.MeshBasicMaterial({ color: '#8b94a8', transparent: true, opacity: 0.08, depthWrite: false }));
    const a = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(a) * (9 + Math.random() * 4), 0.5, Math.sin(a) * (9 + Math.random() * 4));
    m.userData.t = seedTime ? Math.random() * 6 : 0;
    this.scene.add(m);
    this.steam.push(m);
  }

  setBuild(build) {
    const key = JSON.stringify(build);
    if (key === this.buildKey) return;
    this.buildKey = key;
    if (this.fab) { this.scene.remove(this.fab.root); this.fab.dispose(); }
    this.fab = buildMech({ build });
    this.fab.root.position.y = 7.2;
    // relaxed stance
    const N = this.fab.nodes;
    N.upperArmL.rotation.z = -0.12; N.upperArmR.rotation.z = 0.12;
    N.foreArmL.rotation.x = -0.2; N.foreArmR.rotation.x = -0.2;
    N.hipL.rotation.x = -0.04; N.hipR.rotation.x = 0.04;
    this.scene.add(this.fab.root);
    if (this.hlLayer) this.highlight(this.hlLayer);
  }

  highlight(layer) {
    this.hlLayer = layer;
    if (this.hlMesh) { this.scene.remove(this.hlMesh); this.hlMesh = null; }
    if (!layer || !this.fab) return;
    const nodeName = HIGHLIGHT_NODE[layer];
    if (!nodeName) return;
    const node = this.fab.nodes[nodeName];
    if (!node) return;
    this.fab.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(node);
    const size = box.getSize(new V3()), center = box.getCenter(new V3());
    this.hlMesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + 0.5, size.y + 0.5, size.z + 0.5),
      new THREE.MeshBasicMaterial({ color: '#3fd6ff', wireframe: true, transparent: true, opacity: 0.5 })
    );
    this.hlMesh.position.copy(center);
    this.scene.add(this.hlMesh);
    this.hlT = 0;
  }

  setActive(on) { this.active = on; }

  frame(dt) {
    // idle: slow breathing sway + head scanning the bay
    if (this.fab) {
      const t = performance.now() / 1000;
      const N = this.fab.nodes;
      N.chest.position.y = Math.sin(t * 0.8) * 0.05;
      N.chest.rotation.y = Math.sin(t * 0.3) * 0.03;
      N.head.rotation.y = Math.sin(t * 0.42) * 0.3;
      N.head.rotation.x = Math.sin(t * 0.3 + 1) * 0.06;
      this.fab.root.rotation.y += dt * 0.03;   // slow turntable drift
    }
    // steam drifts up and fades
    for (const s of this.steam) {
      s.userData.t += dt;
      s.position.y += dt * 0.7;
      s.scale.setScalar(1 + s.userData.t * 0.25);
      s.material.opacity = Math.max(0, 0.09 - s.userData.t * 0.012);
      if (s.userData.t > 7) {
        s.userData.t = 0;
        const a = Math.random() * Math.PI * 2;
        s.position.set(Math.cos(a) * (9 + Math.random() * 4), 0.4, Math.sin(a) * (9 + Math.random() * 4));
        s.scale.setScalar(1);
      }
    }
    if (this.hlMesh) {
      this.hlT += dt;
      this.hlMesh.material.opacity = 0.3 + Math.sin(this.hlT * 6) * 0.2;
    }

    // orbit camera
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      Math.sin(this.yaw) * cp * this.dist,
      this.focusY + sp * this.dist,
      Math.cos(this.yaw) * cp * this.dist
    );
    this.camera.lookAt(0, this.focusY, 0);
    const w = window.innerWidth, h = window.innerHeight;
    if (this.camera.aspect !== w / h) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.gl.render(this.scene, this.camera);
  }
}

function makeDeckTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#565d6a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(20,22,30,0.65)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 126, 126);
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // tread studs
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (let y = 12; y < 128; y += 24) {
    for (let x = 12; x < 128; x += 24) ctx.fillRect(x, y, 4, 4);
  }
  return new THREE.CanvasTexture(cv);
}

function makeWallTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1c212c';
  ctx.fillRect(0, 0, 512, 256);
  // panel seams
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  for (let x = 0; x < 512; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  for (let y = 0; y < 256; y += 84) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
  // bay number + hazard chevrons
  ctx.font = 'bold 90px "Arial Black", sans-serif';
  ctx.fillStyle = 'rgba(216,160,60,0.22)';
  ctx.fillText('07', 60, 170);
  ctx.fillStyle = 'rgba(216,160,60,0.16)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(300 + i * 30, 220);
    ctx.lineTo(315 + i * 30, 190);
    ctx.lineTo(330 + i * 30, 220);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}
