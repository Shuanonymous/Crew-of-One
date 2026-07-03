import * as CANNON from 'cannon-es';
import { Robot } from './robot.js';
import { PHYSICS_HZ, ROLE } from '../shared/constants.js';

// Phase 1: one world, one robot, a flat test area with props to shove around.
// (Rooms arrive in Phase 2 — this class is already shaped like one room.)

export class Game {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.15;

    this.props = [];       // dynamic bodies that can be grabbed/shoved
    this.propDefs = [];    // what the client should draw for each prop
    this.buildTestArea();

    this.robot = new Robot(this.world, 'r1', { x: 0, y: 3.5, z: 0 }, '#ffb703');
    this.players = new Map(); // playerId -> { roles:Set, name }
    this.tick = 0;
  }

  buildTestArea() {
    // Ground: one big static box
    const ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(60, 1, 60)),
      position: new CANNON.Vec3(0, -1, 0),
    });
    this.world.addBody(ground);

    // A ramp to climb
    const ramp = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(4, 0.3, 6)),
      position: new CANNON.Vec3(12, 1.2, -6),
    });
    ramp.quaternion.setFromEuler(-0.32, 0, 0);
    this.world.addBody(ramp);
    this.staticDefs = [
      { kind: 'ground', size: [120, 2, 120], p: [0, -1, 0], q: [0, 0, 0, 1], color: '#7ec850' },
      { kind: 'ramp', size: [8, 0.6, 12], p: [12, 1.2, -6], q: quatArr(ramp.quaternion), color: '#f4a261' },
    ];

    // Crates and a beach ball to mess with
    const crateSpots = [[-6, 2, -8], [-8, 2, -6], [-7, 4, -7], [6, 2, 8], [8, 2, 6]];
    const colors = ['#e76f51', '#2a9d8f', '#e9c46a', '#9b5de5', '#00bbf9'];
    crateSpots.forEach((p, i) => {
      const body = new CANNON.Body({
        mass: 1.5,
        shape: new CANNON.Box(new CANNON.Vec3(0.7, 0.7, 0.7)),
        position: new CANNON.Vec3(p[0], p[1], p[2]),
      });
      this.world.addBody(body);
      this.props.push(body);
      this.propDefs.push({ id: 'crate' + i, kind: 'box', size: [1.4, 1.4, 1.4], color: colors[i] });
    });

    const ball = new CANNON.Body({
      mass: 1.2,
      shape: new CANNON.Sphere(1.1),
      position: new CANNON.Vec3(0, 3, -10),
    });
    ball.linearDamping = 0.15;
    this.world.addBody(ball);
    this.props.push(ball);
    this.propDefs.push({ id: 'ball', kind: 'ball', size: [1.1], color: '#ff5d8f' });

    // Remember where props started so we can bring back any that fall off
    this.propSpawns = this.props.map((b) => b.position.clone());
  }

  respawnLostProps() {
    for (let i = 0; i < this.props.length; i++) {
      const b = this.props[i];
      if (b.position.y < -15) {
        b.position.copy(this.propSpawns[i]);
        b.position.y += 4; // drop back in from the sky
        b.velocity.setZero();
        b.angularVelocity.setZero();
      }
    }
  }

  addPlayer(id, name) {
    // Phase 1: everyone who joins is the whole crew of the one robot.
    this.players.set(id, { name, roles: new Set([ROLE.ALL]) });
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  // A player sent inputs — apply only the fields their roles allow.
  applyInput(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return;
    const roles = player.roles;
    const inp = this.robot.input;
    const all = roles.has(ROLE.ALL);

    if (all || roles.has(ROLE.LEGS)) {
      if (data.move) { inp.move.x = clamp(data.move.x); inp.move.z = clamp(data.move.z); }
      if (typeof data.jump === 'boolean') inp.jump = data.jump;
    }
    if (all || roles.has(ROLE.ARMS)) {
      if (typeof data.aimYaw === 'number') inp.aimYaw = data.aimYaw;
      if (typeof data.aimPitch === 'number') inp.aimPitch = data.aimPitch;
      if (typeof data.grab === 'boolean') inp.grab = data.grab;
    }
    if (all || roles.has(ROLE.HEAD)) {
      if (typeof data.headYaw === 'number') inp.headYaw = data.headYaw;
      if (typeof data.lean === 'number') inp.lean = clamp(data.lean);
    }
  }

  step() {
    const dt = 1 / PHYSICS_HZ;
    this.robot.update(dt, this.props);
    this.world.step(dt);
    this.respawnLostProps();
    this.tick++;
  }

  snapshot() {
    return {
      tick: this.tick,
      time: Date.now(),
      robots: [this.robot.snapshot()],
      props: this.props.map((b, i) => ({
        id: this.propDefs[i].id,
        p: [rnd(b.position.x), rnd(b.position.y), rnd(b.position.z)],
        q: quatArr(b.quaternion),
      })),
    };
  }

  // Sent once when a client connects: everything static it needs to draw.
  worldInfo() {
    return {
      statics: this.staticDefs,
      props: this.propDefs,
    };
  }
}

function clamp(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }
function rnd(n) { return Math.round(n * 1000) / 1000; }
function quatArr(q) {
  return [rnd(q.x), rnd(q.y), rnd(q.z), rnd(q.w)];
}
