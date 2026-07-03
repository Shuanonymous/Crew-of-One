import * as CANNON from 'cannon-es';
import { ROBOT } from '../shared/constants.js';

// The robot is deliberately simple physics-wise: ONE dynamic torso box that
// hovers on an invisible spring (its "legs"), stays upright via a soft
// balance torque (soft = wobbly), and has two kinematic hand points used
// for grabbing. Limbs are drawn client-side; the server only simulates
// what affects gameplay.

const UP = new CANNON.Vec3(0, 1, 0);

export class Robot {
  constructor(world, id, spawnPos, color) {
    this.world = world;
    this.id = id;
    this.color = color;
    this.spawn = new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z);

    const s = ROBOT.torsoSize;
    const shape = new CANNON.Box(new CANNON.Vec3(s.x / 2, s.y / 2, s.z / 2));
    this.body = new CANNON.Body({
      mass: ROBOT.torsoMass,
      shape,
      position: this.spawn.clone(),
      linearDamping: 0.08,
      angularDamping: 0.35,
    });
    this.body.allowSleep = false;
    world.addBody(this.body);

    // Merged inputs (in multiplayer, different players write different fields)
    this.input = {
      move: { x: 0, z: 0 },   // legs: WASD, in head-relative space
      jump: false,            // legs: space
      lean: 0,                // head: -1..1 (A/D)
      headYaw: 0,             // head: camera direction = robot "forward"
      aimYaw: 0,              // arms: where the hands reach
      aimPitch: 0,
      grab: false,            // arms: mouse button
    };

    this.grounded = false;
    this.ragdollT = 0;        // >0 means flopping
    this.tiltT = 0;           // how long we've been past the tilt threshold
    this.jumpCooldown = 0;
    this.grabConstraint = null;
    this.grabbedBody = null;
    this.prevGrab = false;
    this.handL = new CANNON.Vec3();
    this.handR = new CANNON.Vec3();
    this.walkSpeed = 0;       // horizontal speed, for client leg animation
    this.events = [];         // one-shot events drained into snapshots
  }

  get isRagdoll() { return this.ragdollT > 0; }

  update(dt, grabbables) {
    const b = this.body;

    if (this.ragdollT > 0) {
      this.ragdollT -= dt;
      if (this.ragdollT <= 0) this.respawn();
      this.updateHands();
      return;
    }

    // --- ground probe (a ray straight down from the torso) ---
    const from = b.position;
    const to = new CANNON.Vec3(from.x, from.y - ROBOT.standHeight * 1.3, from.z);
    const ray = new CANNON.RaycastResult();
    this.world.raycastClosest(from, to, { skipBackfaces: true, collisionFilterMask: -1 }, ray);
    // Ignore hits on ourselves or the object we're holding
    const hitDist = ray.hasHit && ray.body !== b ? from.y - ray.hitPointWorld.y : Infinity;
    this.grounded = hitDist < ROBOT.standHeight * 1.15;

    // --- hover spring: the invisible legs ---
    if (this.grounded && this.jumpCooldown <= 0) {
      const compress = ROBOT.standHeight - hitDist;
      // gravity feed-forward so the robot rests at exactly standHeight
      let f = compress * ROBOT.hoverStrength - b.velocity.y * ROBOT.hoverDamping
        + b.mass * -this.world.gravity.y;
      if (f < 0) f = 0; // push up only, never suck down (lets jumps feel free)
      // NOTE: applyForce's 2nd arg is an offset from the center of mass,
      // NOT a world position. Omitting it applies at the center (no torque).
      b.applyForce(new CANNON.Vec3(0, f, 0));
    }
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;

    // --- balance: soft torque toward "up" (tilted by the lean input) ---
    const lean = Math.max(-1, Math.min(1, this.input.lean)) * ROBOT.maxLeanRad;
    // Lean tilts the target-up sideways relative to where the head looks
    const yaw = this.input.headYaw;
    const right = new CANNON.Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
    const targetUp = new CANNON.Vec3(
      UP.x + right.x * Math.sin(lean),
      Math.cos(lean),
      UP.z + right.z * Math.sin(lean)
    );
    targetUp.normalize();

    const curUp = new CANNON.Vec3(0, 1, 0);
    b.quaternion.vmult(curUp, curUp);
    const axis = curUp.cross(targetUp);
    const angle = Math.asin(Math.min(1, axis.length()));
    if (axis.length() > 1e-6) axis.normalize();
    const torque = axis.scale(angle * ROBOT.balanceStrength);
    torque.x -= b.angularVelocity.x * ROBOT.balanceDamping;
    torque.z -= b.angularVelocity.z * ROBOT.balanceDamping;
    b.torque.vadd(torque, b.torque);

    // --- face where the head looks (soft, so it lags comically) ---
    const fwd = new CANNON.Vec3(0, 0, -1);
    b.quaternion.vmult(fwd, fwd);
    const curYaw = Math.atan2(-fwd.x, -fwd.z);
    let yawErr = yaw - curYaw;
    while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
    while (yawErr < -Math.PI) yawErr += 2 * Math.PI;
    b.torque.y += yawErr * 28 - b.angularVelocity.y * 9;

    // --- walking: a force in the head-relative input direction ---
    const mv = this.input.move;
    const mlen = Math.hypot(mv.x, mv.z);
    if (mlen > 0.01 && this.grounded) {
      const nx = mv.x / Math.max(1, mlen);
      const nz = mv.z / Math.max(1, mlen);
      // rotate the stick direction by the head yaw
      const wx = nx * Math.cos(yaw) + nz * Math.sin(yaw);
      const wz = -nx * Math.sin(yaw) + nz * Math.cos(yaw);
      const hSpeed = Math.hypot(b.velocity.x, b.velocity.z);
      const scale = hSpeed > ROBOT.maxWalkSpeed ? 0 : 1;
      // applied slightly above the center of mass so accelerating makes it
      // tip a bit (funny) — but only a bit, or it faceplants on flat ground
      b.applyForce(
        new CANNON.Vec3(wx * ROBOT.walkForce * scale, 0, wz * ROBOT.walkForce * scale),
        new CANNON.Vec3(0, 0.3, 0)
      );
    }
    this.walkSpeed = Math.hypot(b.velocity.x, b.velocity.z);

    // --- jump ---
    if (this.input.jump && this.grounded && this.jumpCooldown <= 0) {
      b.applyImpulse(new CANNON.Vec3(0, ROBOT.jumpImpulse, 0));
      this.jumpCooldown = 0.35;
      this.events.push({ what: 'jump' });
    }

    // --- arms: hands reach where the arms player aims ---
    this.updateHands();
    this.updateGrab(grabbables);

    // --- falling over ---
    const uprightness = curUp.dot(UP);
    if (uprightness < ROBOT.fallDotThreshold) {
      this.tiltT += dt;
      if (this.tiltT > ROBOT.fallGraceSec) this.startRagdoll();
    } else {
      this.tiltT = 0;
    }
    if (b.position.y < -12) this.startRagdoll(); // fell off the world
  }

  updateHands() {
    const b = this.body;

    // While carrying something, the hands hug it in front of the chest.
    if (this.grabConstraint) {
      const mk = (side, out) => {
        const local = new CANNON.Vec3(side * 0.6, 0.15, -1.4);
        b.quaternion.vmult(local, out);
        out.vadd(b.position, out);
      };
      mk(-1, this.handL);
      mk(1, this.handR);
      return;
    }

    // Otherwise: shoulders in torso-local space, hands reach along the aim.
    const reach = this.isRagdoll ? 0.6 : ROBOT.armReach;
    const dir = new CANNON.Vec3(
      -Math.sin(this.input.aimYaw) * Math.cos(this.input.aimPitch),
      Math.sin(this.input.aimPitch),
      -Math.cos(this.input.aimYaw) * Math.cos(this.input.aimPitch)
    );
    const mkHand = (side, out) => {
      const shoulder = new CANNON.Vec3(side * (ROBOT.torsoSize.x / 2 + 0.15), 0.7, 0);
      b.quaternion.vmult(shoulder, shoulder);
      shoulder.vadd(b.position, shoulder);
      out.set(
        shoulder.x + dir.x * reach + side * 0.35,
        shoulder.y + dir.y * reach,
        shoulder.z + dir.z * reach
      );
    };
    mkHand(-1, this.handL);
    mkHand(1, this.handR);
  }

  updateGrab(grabbables) {
    const justPressed = this.input.grab && !this.prevGrab;
    this.prevGrab = this.input.grab;
    if (this.input.grab && !this.grabConstraint) {
      // Try to grab: nearest dynamic prop within reach of either hand
      let best = null, bestD = ROBOT.grabRadius, bestHand = null;
      for (const g of grabbables) {
        for (const hand of [this.handL, this.handR]) {
          const d = g.position.distanceTo(hand);
          if (d < bestD) { best = g; bestD = d; bestHand = hand; }
        }
      }
      if (best) {
        // Hug the object to a point in front of the chest. A short lever
        // keeps carrying stable, and the capped grip force means a stuck
        // object stretches your grip instead of winching you off your feet.
        const carryLocal = new CANNON.Vec3(0, 0.2, -1.5);
        this.grabConstraint = new CANNON.PointToPointConstraint(
          this.body, carryLocal, best, new CANNON.Vec3(0, 0, 0), 180
        );
        // A held object must not collide with the torso holding it,
        // or the grip and the collision fight and knock the robot over.
        this.grabConstraint.collideConnected = false;
        this.world.addConstraint(this.grabConstraint);
        this.grabbedBody = best;
        this.events.push({ what: 'grab' });
      } else if (justPressed) {
        // Nothing in reach on the initial click: SHOVE whatever is near.
        // (Holding the button keeps trying to grab instead, so you can
        // hold click and walk in to latch on.)
        for (const g of grabbables) {
          for (const hand of [this.handL, this.handR]) {
            if (g.position.distanceTo(hand) < ROBOT.grabRadius * 1.8) {
              const dir = g.position.clone().vsub(this.body.position);
              dir.y = Math.abs(dir.y) + 0.4; // pop it upward a little (funnier)
              dir.normalize();
              g.applyImpulse(dir.scale(ROBOT.shoveImpulse));
              this.events.push({ what: 'shove' });
            }
          }
        }
      }
    }
    if (!this.input.grab && this.grabConstraint) this.releaseGrab();
  }

  releaseGrab() {
    if (this.grabConstraint) {
      this.world.removeConstraint(this.grabConstraint);
      this.grabConstraint = null;
      this.grabbedBody = null;
    }
  }

  startRagdoll() {
    if (this.isRagdoll) return;
    this.ragdollT = ROBOT.ragdollSec;
    this.tiltT = 0;
    this.releaseGrab();
    // A comedic parting spin
    this.body.angularVelocity.set(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 8
    );
    this.body.angularDamping = 0.1;
    this.events.push({ what: 'fell' });
  }

  respawn() {
    const b = this.body;
    b.position.copy(this.spawn);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.quaternion.set(0, 0, 0, 1);
    b.angularDamping = 0.35;
    this.ragdollT = 0;
    this.events.push({ what: 'respawn' });
  }

  setSpawn(pos) {
    this.spawn.set(pos.x, pos.y, pos.z);
  }

  snapshot() {
    const b = this.body;
    const snap = {
      id: this.id,
      color: this.color,
      p: [rnd(b.position.x), rnd(b.position.y), rnd(b.position.z)],
      q: [rnd(b.quaternion.x), rnd(b.quaternion.y), rnd(b.quaternion.z), rnd(b.quaternion.w)],
      hl: [rnd(this.handL.x), rnd(this.handL.y), rnd(this.handL.z)],
      hr: [rnd(this.handR.x), rnd(this.handR.y), rnd(this.handR.z)],
      walk: rnd(this.walkSpeed),
      grounded: this.grounded,
      ragdoll: this.isRagdoll,
      grabbing: !!this.grabConstraint,
      headYaw: rnd(this.input.headYaw),
      aimPitch: rnd(this.input.aimPitch),
      lean: rnd(this.input.lean),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}

function rnd(n) { return Math.round(n * 1000) / 1000; }
