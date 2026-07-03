import * as THREE from 'three';

// Everything visual: the scene, the low-poly world, and the wobbly robot.
// The server tells us WHERE things are; this file makes them look funny.

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8ecae6');
    this.scene.fog = new THREE.Fog('#8ecae6', 60, 160);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
    this.camDist = 13;

    const hemi = new THREE.HemisphereLight('#ffffff', '#88aa66', 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
    this.scene.add(sun);

    this.robots = new Map(); // robotId -> RobotView
    this.propMeshes = new Map();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Build static scenery + props from the server's world description.
  buildWorld(world) {
    for (const s of world.statics) {
      const geo = new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
      const mat = new THREE.MeshLambertMaterial({ color: s.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.p[0], s.p[1], s.p[2]);
      mesh.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    for (const d of world.props) {
      let mesh;
      if (d.kind === 'ball') {
        mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(d.size[0], 1),
          new THREE.MeshLambertMaterial({ color: d.color, flatShading: true })
        );
      } else {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(d.size[0], d.size[1], d.size[2]),
          new THREE.MeshLambertMaterial({ color: d.color })
        );
      }
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.propMeshes.set(d.id, mesh);
    }

    this.addScenery();
  }

  // Purely decorative low-poly bits so you can tell you're moving.
  addScenery() {
    const rng = mulberry32(12345);
    const treeMat = new THREE.MeshLambertMaterial({ color: '#4c9f38', flatShading: true });
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#8d5a2b' });
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = 34 + rng() * 22;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = 2.5 + rng() * 3;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4 + rng(), h, 6), treeMat);
      cone.position.set(x, h / 2 + 0.8, z);
      cone.castShadow = true;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 5), trunkMat);
      trunk.position.set(x, 0.4, z);
      this.scene.add(cone, trunk);
    }
    // Basic material = pure flat white, so clouds never pick up ground tint
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#f7fbff' });
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 3; j++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rng() * 2, 0), cloudMat);
        puff.position.set(j * 2.6 - 2.6, rng(), rng() * 2);
        cloud.add(puff);
      }
      cloud.position.set((rng() - 0.5) * 160, 26 + rng() * 14, (rng() - 0.5) * 160);
      this.scene.add(cloud);
    }
  }

  getRobotView(snap) {
    let view = this.robots.get(snap.id);
    if (!view) {
      view = new RobotView(this.scene, snap.color);
      this.robots.set(snap.id, view);
    }
    return view;
  }

  // Apply an interpolated sample { a, b, alpha } from the network.
  applySample(sample, dt) {
    const { a, b, alpha } = sample;

    for (let i = 0; i < b.robots.length; i++) {
      const rb = b.robots[i];
      const ra = a.robots.find((r) => r.id === rb.id) || rb;
      const view = this.getRobotView(rb);
      view.applyState(ra, rb, alpha, dt);
    }

    for (let i = 0; i < b.props.length; i++) {
      const pb = b.props[i];
      const pa = a.props.find((p) => p.id === pb.id) || pb;
      const mesh = this.propMeshes.get(pb.id);
      if (!mesh) continue;
      mesh.position.set(
        lerp(pa.p[0], pb.p[0], alpha),
        lerp(pa.p[1], pb.p[1], alpha),
        lerp(pa.p[2], pb.p[2], alpha)
      );
      const qa = new THREE.Quaternion(pa.q[0], pa.q[1], pa.q[2], pa.q[3]);
      const qb = new THREE.Quaternion(pb.q[0], pb.q[1], pb.q[2], pb.q[3]);
      mesh.quaternion.copy(qa.slerp(qb, alpha));
    }
  }

  // Third-person camera orbiting the (first) robot.
  updateCamera(yaw, pitch) {
    const view = this.robots.values().next().value;
    const target = view ? view.root.position.clone() : new THREE.Vector3();
    target.y += 2.2;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = new THREE.Vector3(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    const pos = target.clone().sub(dir.multiplyScalar(this.camDist));
    if (pos.y < 0.6) pos.y = 0.6;
    this.camera.position.lerp(pos, 0.35);
    this.camera.lookAt(target);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------------------
// One robot's visuals: boxy body, googly eyes, noodle arms, scissoring legs.
// ---------------------------------------------------------------------------
class RobotView {
  constructor(scene, color) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    const main = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: '#2b2d42' });
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });

    // Torso
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.0), main);
    this.torso.castShadow = true;
    this.root.add(this.torso);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.1), dark);
    belly.position.set(0, -0.3, -0.53);
    this.root.add(belly);

    // Head (turns separately so it can "look around")
    this.head = new THREE.Group();
    this.head.position.set(0, 1.65, 0);
    this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.9), main);
    skull.castShadow = true;
    this.head.add(skull);

    // GOOGLY EYES — the soul of the robot
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), white);
      eye.position.set(side * 0.28, 0.08, -0.48);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), dark);
      pupil.position.set(0, 0, -0.17);
      eye.add(pupil);
      this.head.add(eye);
      this.eyes.push({ pupil, vx: 0, vy: 0, x: 0, y: 0 });
    }

    // Antenna with a bobble
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5), dark);
    stick.position.set(0, 0.7, 0);
    this.head.add(stick);
    this.bobble = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshLambertMaterial({ color: '#ff5d8f' }));
    this.bobble.position.set(0, 1.0, 0);
    this.head.add(this.bobble);

    // Legs (visual only — the server's "legs" are an invisible spring)
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.45, -1.1, 0);
      this.root.add(hip);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.3, 0.42), dark);
      thigh.position.set(0, -0.6, 0);
      hip.add(thigh);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.9), main);
      foot.position.set(0, -1.3, -0.15);
      foot.castShadow = true;
      hip.add(foot);
      this.legs.push(hip);
    }
    this.walkPhase = 0;

    // Arms: world-space noodles from shoulders to the server's hand points.
    // Each arm = upper segment + forearm segment + elbow + hand.
    const armMat = new THREE.MeshLambertMaterial({ color: '#2b2d42' });
    this.arms = [];
    for (const side of [-1, 1]) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 1), armMat);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 1), armMat);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), armMat);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), main);
      upper.castShadow = fore.castShadow = hand.castShadow = true;
      scene.add(upper, fore, elbow, hand);
      this.arms.push({ side, upper, fore, elbow, hand, handPos: new THREE.Vector3() });
    }

    this.prevPos = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
  }

  applyState(ra, rb, alpha, dt) {
    // Interpolate body position/rotation between the two snapshots
    this.root.position.set(
      lerp(ra.p[0], rb.p[0], alpha),
      lerp(ra.p[1], rb.p[1], alpha),
      lerp(ra.p[2], rb.p[2], alpha)
    );
    const qa = new THREE.Quaternion(ra.q[0], ra.q[1], ra.q[2], ra.q[3]);
    const qb = new THREE.Quaternion(rb.q[0], rb.q[1], rb.q[2], rb.q[3]);
    this.root.quaternion.copy(qa.slerp(qb, alpha));

    // Track velocity for the googly-eye jiggle
    if (dt > 0) {
      this.velocity.copy(this.root.position).sub(this.prevPos).divideScalar(dt);
      this.prevPos.copy(this.root.position);
    }

    // Head looks toward headYaw (relative to the body's own yaw)
    const bodyYaw = getYaw(this.root.quaternion);
    let headRel = (rb.headYaw ?? 0) - bodyYaw;
    while (headRel > Math.PI) headRel -= 2 * Math.PI;
    while (headRel < -Math.PI) headRel += 2 * Math.PI;
    this.head.rotation.y += (clampAngle(headRel, 1.1) - this.head.rotation.y) * 0.2;

    // Googly eyes: pupils are tiny physics sims that slosh around
    for (const e of this.eyes) {
      const ax = -this.velocity.x * 0.02 + (Math.random() - 0.5) * 0.01;
      const ay = this.velocity.y * 0.015 + (Math.random() - 0.5) * 0.01;
      e.vx += (ax - e.x * 0.25) * 0.5; e.vy += (ay - e.y * 0.25) * 0.5;
      e.vx *= 0.85; e.vy *= 0.85;
      e.x = clampN(e.x + e.vx, 0.09); e.y = clampN(e.y + e.vy, 0.09);
      e.pupil.position.set(e.x, e.y, -0.17);
    }

    // Bobble antenna lags behind movement
    this.bobble.position.x = clampN(-this.velocity.x * 0.02, 0.35);
    this.bobble.position.z = clampN(-this.velocity.z * 0.02, 0.35);

    // Legs scissor while walking; splay when ragdolling; tuck in air
    if (rb.ragdoll) {
      this.legs[0].rotation.x += (2.4 - this.legs[0].rotation.x) * 0.15;
      this.legs[1].rotation.x += (-2.0 - this.legs[1].rotation.x) * 0.15;
      this.legs[0].rotation.z = 0.5; this.legs[1].rotation.z = -0.5;
    } else if (!rb.grounded) {
      for (const l of this.legs) {
        l.rotation.x += (-0.7 - l.rotation.x) * 0.2;
        l.rotation.z *= 0.8;
      }
    } else {
      this.walkPhase += rb.walk * dt * 2.2;
      const swing = Math.min(1, rb.walk / 4) * 0.8;
      this.legs[0].rotation.x = Math.sin(this.walkPhase) * swing;
      this.legs[1].rotation.x = Math.sin(this.walkPhase + Math.PI) * swing;
      this.legs[0].rotation.z *= 0.8; this.legs[1].rotation.z *= 0.8;
    }

    // Arms: draw noodle segments to the interpolated hand positions
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const ha = i === 0 ? ra.hl : ra.hr;
      const hb = i === 0 ? rb.hl : rb.hr;
      arm.handPos.set(lerp(ha[0], hb[0], alpha), lerp(ha[1], hb[1], alpha), lerp(ha[2], hb[2], alpha));

      const shoulder = new THREE.Vector3(arm.side * 0.95, 0.7, 0)
        .applyQuaternion(this.root.quaternion).add(this.root.position);

      // Elbow: midpoint, drooping downward — instant noodle
      const mid = shoulder.clone().add(arm.handPos).multiplyScalar(0.5);
      mid.y -= rb.ragdoll ? 1.0 : 0.55;

      placeSegment(arm.upper, shoulder, mid);
      placeSegment(arm.fore, mid, arm.handPos);
      arm.elbow.position.copy(mid);
      arm.hand.position.copy(arm.handPos);
      const s = rb.grabbing ? 1.5 : 1.0;
      arm.hand.scale.set(s, s, s);
    }
  }
}

// Stretch a unit cylinder between two points.
function placeSegment(mesh, a, b) {
  const dir = b.clone().sub(a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clampN(n, m) { return Math.max(-m, Math.min(m, n)); }
function clampAngle(a, m) { return Math.max(-m, Math.min(m, a)); }
function getYaw(q) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-fwd.x, -fwd.z);
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
