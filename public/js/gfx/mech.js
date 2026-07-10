import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MECH } from '/shared/constants.js';
import {
  V3, CAMERA_Q, lerp, ease, damp, clampN, getYaw, placeSegment,
} from './util.js';
import { armorSet, steelSet, flareSprite } from './materials.js';

// THE MECH. Painted military plate over machined steel joints — every armor
// surface carries a real albedo/normal/roughness set (panel seams, rivet
// rows, chipped edges, stencils), so raking light shows engineering, not
// primitive shapes. Rig + animation contract unchanged: reads snapshot
// state, animates locally.
export class MechView {
  constructor(scene, color = '#f5b13d') {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    const armor = armorSet(color);
    const steel = steelSet();
    const main = new THREE.MeshStandardMaterial({
      map: armor.map, normalMap: armor.normalMap, normalScale: new THREE.Vector2(1, 1),
      roughnessMap: armor.roughnessMap, roughness: 1.0, metalness: 0.78, envMapIntensity: 1.15,
    });
    // secondary plate: same sheet, dimmed — reads as a darker paint batch
    const plate = new THREE.MeshStandardMaterial({
      color: '#9aa0ab',
      map: armor.map, normalMap: armor.normalMap, normalScale: new THREE.Vector2(1, 1),
      roughnessMap: armor.roughnessMap, roughness: 1.0, metalness: 0.85, envMapIntensity: 1.25,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: '#c9ccd4', map: steel.map, roughnessMap: steel.roughnessMap,
      metalness: 0.92, roughness: 1.0, envMapIntensity: 1.1,
    });
    const piston = new THREE.MeshStandardMaterial({
      color: '#dfe3ea', metalness: 1.0, roughness: 0.12, envMapIntensity: 1.6,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: '#17181d', metalness: 0.1, roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({
      color: '#0a0d18', metalness: 0.5, roughness: 0.3,
      emissive: new THREE.Color('#3fe6ff'), emissiveIntensity: 3.2,
    });
    const hazard = new THREE.MeshStandardMaterial({
      color: '#1a1206', metalness: 0.6, roughness: 0.5,
      emissive: new THREE.Color('#ff8a1e'), emissiveIntensity: 1.8,
    });
    this.mats = { main, dark, trim, plate };

    const P = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    };
    // machined, softened edges on every plate
    const bevel = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.14);

    // ================= TORSO =================
    P(this.root, new THREE.CylinderGeometry(2.5, 1.9, 3.4, 20), main, 0, 0.9, 0);   // upper chest drum
    P(this.root, bevel(3.0, 1.6, 2.2), plate, 0, 1.6, -0.2);                        // chest plate
    P(this.root, bevel(1.8, 1.9, 1.8), dark, 0, -1.8, 0);                           // waist block
    P(this.root, bevel(2.6, 0.5, 2.2), plate, 0, -0.9, 0);                          // belt
    // hip skirt armor: hanging plates around the waist
    P(this.root, bevel(0.9, 1.4, 0.28), main, -1.15, -1.7, 0, 0, Math.PI / 2, 0.12);
    P(this.root, bevel(0.9, 1.4, 0.28), main, 1.15, -1.7, 0, 0, -Math.PI / 2, -0.12);
    P(this.root, bevel(0.9, 1.4, 0.28), main, 0, -1.7, -1.05, 0.14, 0, 0);
    P(this.root, bevel(0.9, 1.4, 0.28), main, 0, -1.7, 1.05, -0.14, 0, 0);
    // angled pectoral plates
    for (const s of [-1, 1]) P(this.root, bevel(1.3, 1.5, 0.5), plate, s * 0.85, 1.5, -1.15, 0.2, 0, -s * 0.25);
    // glowing reactor core
    this.reactor = P(this.root, new THREE.CylinderGeometry(0.55, 0.55, 0.4, 16), trim, 0, 0.9, -1.35, Math.PI / 2, 0, 0);
    P(this.root, new THREE.TorusGeometry(0.62, 0.09, 8, 20), dark, 0, 0.9, -1.4, 0, 0, 0); // reactor bezel
    // back thruster pods
    for (const s of [-1, 1]) {
      P(this.root, new THREE.CylinderGeometry(0.5, 0.62, 2.2, 12), dark, s * 1.1, 1.2, 1.4);
      P(this.root, new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12), hazard, s * 1.1, 0.1, 1.5);
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
      P(sh, new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8), piston, 0, -0.2, 0, Math.PI / 2, 0, 0); // rivet bar
      P(sh, bevel(0.4, 0.4, 0.4), trim, 0, 0.4, -1.4);             // marker light
      // nav strobe sprite (red port / green starboard)
      const strobe = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flareSprite(), color: s < 0 ? '#ff3344' : '#33ff66',
        transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      strobe.scale.setScalar(1.1);
      strobe.position.set(s * 1.15, 0.9, 0);
      sh.add(strobe);
      (this.strobes = this.strobes || []).push({ sprite: strobe, phase: s < 0 ? 0 : 0.5 });
    }
    // power cables: sagging conduit from the backpack to each pauldron
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new V3(s * 0.6, 1.9, 1.35),
        new V3(s * 1.8, 1.55, 0.95),
        new V3(s * 2.5, 2.35, 0.45),
      ]);
      P(this.root, new THREE.TubeGeometry(curve, 10, 0.09, 6), rubber);
    }

    // ================= HEAD (angular, T-visor) =================
    this.head = new THREE.Group();
    this.head.position.set(0, 3.35, -0.1);
    this.root.add(this.head);
    P(this.head, new THREE.CylinderGeometry(0.95, 1.15, 1.5, 6), main, 0, 0, 0);   // faceted skull
    P(this.head, bevel(1.9, 0.7, 0.4), dark, 0, 0.1, -0.85);                        // brow
    P(this.head, bevel(0.9, 0.55, 0.4), plate, 0, -0.55, -0.7);                     // chin guard
    for (const s of [-1, 1]) P(this.head, bevel(0.35, 0.7, 0.7), dark, s * 1.0, 0, 0.1); // comms blocks
    // the eye: a horizontal T-visor slit (emissive; charges up)
    this.eye = new THREE.Mesh(bevel(1.35, 0.32, 0.18), new THREE.MeshBasicMaterial({ color: '#7fe9ff' }));
    this.eye.position.set(0, -0.05, -0.92);
    this.head.add(this.eye);
    P(this.head, bevel(0.16, 0.9, 1.1), plate, 0, 0.7, 0.2, -0.5, 0, 0);            // swept crest fin
    // whip antenna
    P(this.head, new THREE.CylinderGeometry(0.03, 0.015, 1.6, 5), dark, -0.75, 1.1, 0.35, 0, 0, 0.18);
    // blinking sensor light (ragdoll/charge indicator)
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
      P(hip, new THREE.SphereGeometry(0.7, 16, 12), dark, 0, 0, 0);                 // hip ball
      P(hip, new THREE.CylinderGeometry(0.9, 0.75, 2.4, 16), main, 0, -1.3, 0);     // thigh armor
      P(hip, bevel(0.5, 1.8, 0.5), plate, side * 0.7, -1.3, 0.1);                  // thigh side plate
      P(hip, new THREE.CylinderGeometry(0.12, 0.12, 2.0, 6), piston, side * 0.35, -1.3, 0.55); // hydraulic rod

      const shinG = new THREE.Group();
      shinG.position.y = -2.6;
      hip.add(shinG);
      P(shinG, new THREE.SphereGeometry(0.5, 14, 10), piston, 0, 0.1, 0);           // knee actuator
      P(shinG, bevel(0.3, 0.9, 0.3), piston, 0, 0.55, 0.4);                        // knee piston
      P(shinG, bevel(0.9, 0.6, 0.6), plate, 0, 0.15, -0.45);                       // knee cap plate
      P(shinG, new THREE.CylinderGeometry(0.7, 0.55, 2.2, 16), main, 0, -1.1, 0);   // shin
      P(shinG, bevel(1.0, 1.4, 0.4), plate, 0, -1.0, -0.55);                       // shin guard
      P(shinG, new THREE.CylinderGeometry(0.08, 0.08, 1.7, 5), rubber, 0.42, -1.1, 0.45, 0.1, 0, 0); // brake line
      // splayed foot with toe plates + heel
      P(shinG, bevel(1.5, 0.5, 2.4), dark, 0, -2.3, -0.2);                         // foot base
      P(shinG, bevel(1.5, 0.35, 0.7), plate, 0, -2.15, -1.5);                      // toe
      P(shinG, bevel(1.0, 0.5, 0.6), dark, 0, -2.3, 1.0);                          // heel spur
      this.legs.push({ hip, shinG, side });
    }
    this.walkPhase = 0;

    // ================= ARMS =================
    // Tubular segments that stretch cleanly on rocket-punches; sculpted
    // detail lives in the fist and elbow.
    this.arms = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const upper = new THREE.Group();
      P(upper, new THREE.CapsuleGeometry(0.46, 0.55, 4, 14), main, 0, 0, 0);
      P(upper, new THREE.CylinderGeometry(0.6, 0.58, 0.28, 12), plate, 0, 0.34, 0); // shoulder cuff
      const fore = new THREE.Group();
      P(fore, new THREE.CylinderGeometry(0.36, 0.34, 1, 12), piston, 0, 0, 0);      // bright ram core
      P(fore, new THREE.CylinderGeometry(0.52, 0.4, 0.5, 12), main, 0, 0.28, 0);    // forearm housing
      P(fore, new THREE.CylinderGeometry(0.4, 0.46, 0.22, 12), dark, 0, -0.42, 0);  // wrist collar
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), piston);
      elbow.castShadow = true;
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
    this.beamGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flareSprite(), color: '#f3d9ff', transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.beamGlow.scale.setScalar(7);
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

    const now = performance.now();
    // warning light blinks slowly, glows harder while charging
    const blink = (Math.sin(now / 450) + 1) / 2;
    this.blinker.material.color.setRGB(1, 0.2 + blink * 0.2, 0.3);
    this.blinker.scale.setScalar(0.8 + blink * 0.5 + charge * 1.2);
    // reactor breathes; nav strobes flash on a 1.4s aviation cadence
    this.reactor.material.emissiveIntensity = 2.7 + Math.sin(now / 520) * 0.7 + charge * 2;
    for (const st of this.strobes) {
      const t = ((now / 1400) + st.phase) % 1;
      st.sprite.material.opacity = t < 0.08 ? 0.95 : 0.0;
    }

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
      placeSegment(this.beam, from, to);
      placeSegment(this.beamSheath, from, to);
      const pulse = 0.9 + Math.random() * 0.35;
      this.beam.scale.x = pulse; this.beam.scale.z = pulse;
      this.beamSheath.scale.x = pulse * 1.2; this.beamSheath.scale.z = pulse * 1.2;
      this.beam.visible = this.beamSheath.visible = true;
      this.beamGlow.visible = true;
      this.beamGlow.position.copy(to);
      this.beamGlow.scale.setScalar(6 + Math.random() * 4);
      this.guide.visible = this.reticle.visible = false;
    } else {
      this.beam.visible = this.beamSheath.visible = this.beamGlow.visible = false;
      // guide line: thin normally, hot and thick while charging
      if (mb.laser.aim && !mb.ragdoll && !mb.dead) {
        const to = new V3(...mb.laser.aim);
        placeSegment(this.guide, eyeWorld, to);
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
