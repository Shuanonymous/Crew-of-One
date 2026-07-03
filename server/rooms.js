import { BrawlGame } from './brawl.js';
import { DuelGame } from './duel.js';
import { TrainingGame } from './training.js';
import { PHYSICS_HZ, SNAPSHOT_HZ, MSG, MODES, ROLE, splitRoles } from '../shared/constants.js';

// Rooms: 4-letter codes, a host, a lobby, and one running game.
// No accounts — a player IS their websocket.

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (look like 1/0)
const MAX_PLAYERS = 8;

export class RoomManager {
  constructor() {
    this.rooms = new Map();   // code -> Room
    this.players = new Map(); // playerId -> { ws, name, room }
    this.nextId = 1;
  }

  connect(ws) {
    const id = 'p' + this.nextId++;
    this.players.set(id, { id, ws, name: 'Pilot', room: null });
    send(ws, { t: MSG.WELCOME, playerId: id });
    return id;
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (p?.room) p.room.removePlayer(id);
    this.players.delete(id);
  }

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    const room = p.room;

    switch (msg.t) {
      case MSG.CREATE: {
        if (room) room.removePlayer(id);
        p.name = cleanName(msg.name);
        const newRoom = new Room(this.makeCode(), this);
        this.rooms.set(newRoom.code, newRoom);
        newRoom.addPlayer(p);
        break;
      }
      case MSG.JOIN: {
        const code = String(msg.code || '').toUpperCase().trim();
        const target = this.rooms.get(code);
        if (!target) return send(p.ws, { t: MSG.ERR, msg: `No room called ${code || '????'}` });
        if (target.players.size >= MAX_PLAYERS) return send(p.ws, { t: MSG.ERR, msg: 'That room is full (8 max)' });
        if (room) room.removePlayer(id);
        p.name = cleanName(msg.name);
        target.addPlayer(p);
        break;
      }
      case MSG.LEAVE:
        if (room) room.removePlayer(id);
        break;
      case MSG.SET_MODE:
        room?.setMode(id, msg.mode);
        break;
      case MSG.START:
        room?.start(id);
        break;
      case MSG.INPUT:
        room?.input(id, msg.data);
        break;
      case MSG.BUY:
        room?.buy(id, msg.item);
        break;
      case MSG.SHOP_DONE:
        room?.shopDone(id);
        break;
      case MSG.AGAIN:
        room?.again(id);
        break;
    }
  }

  makeCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  dispose(room) {
    room.stopLoop();
    this.rooms.delete(room.code);
  }
}

export class Room {
  constructor(code, manager) {
    this.code = code;
    this.manager = manager;
    this.players = new Map(); // id -> { id, ws, name, roles: [], crew: 'A'|'B' }
    this.hostId = null;
    this.mode = MODES.BRAWL;
    this.game = null;
    this.loop = null;
    this.snapLoop = null;
    this.roleRotation = 0;    // bump every round so roles shuffle
  }

  get playing() { return !!this.game; }

  addPlayer(p) {
    p.room = this;
    this.players.set(p.id, { id: p.id, ws: p.ws, name: p.name, roles: [], crew: 'A' });
    if (!this.hostId) this.hostId = p.id;
    // joining mid-game: become a spectator until next round (roles = [])
    if (this.playing) {
      this.assignCrews(); // rebalance crews for duels at next start; spectate now
      send(p.ws, {
        t: MSG.GAME_START,
        mode: this.mode,
        world: this.game.worldInfo(),
        roles: [],
        spectator: true,
      });
    }
    this.broadcastRoom();
  }

  removePlayer(id) {
    const leaving = this.players.get(id);
    this.players.delete(id);
    if (leaving) leaving.roles = leaving.roles || [];
    const p = this.manager.players.get(id);
    if (p) p.room = null;

    if (this.players.size === 0) return this.manager.dispose(this);
    if (this.hostId === id) this.hostId = this.players.keys().next().value;

    // mid-game: merge the departed roles into a remaining crewmate
    if (this.playing && leaving && leaving.roles.length) {
      const mates = [...this.players.values()]
        .filter((q) => q.crew === leaving.crew && q.roles.length > 0)
        .sort((a, b) => a.roles.length - b.roles.length);
      if (mates.length) {
        mates[0].roles = [...new Set([...mates[0].roles, ...leaving.roles])];
        this.sendRoles();
      }
    }
    this.broadcastRoom();
  }

  setMode(id, mode) {
    if (id !== this.hostId || this.playing) return;
    if (Object.values(MODES).includes(mode)) {
      this.mode = mode;
      this.broadcastRoom();
    }
  }

  assignCrews() {
    const list = [...this.players.values()];
    if (this.mode === MODES.DUEL) {
      // split alternating so both crews are as even as possible
      list.forEach((p, i) => { p.crew = i % 2 === 0 ? 'A' : 'B'; });
    } else {
      list.forEach((p) => { p.crew = 'A'; });
    }
  }

  assignRoles() {
    // rotate the player order every round so everyone gets new jobs
    const byCrew = { A: [], B: [] };
    for (const p of this.players.values()) byCrew[p.crew].push(p);
    for (const crew of ['A', 'B']) {
      const members = byCrew[crew];
      if (!members.length) continue;
      const rot = this.roleRotation % members.length;
      const order = [...members.slice(rot), ...members.slice(0, rot)];
      const split = splitRoles(order.length);
      order.forEach((p, i) => { p.roles = split[Math.min(i, split.length - 1)] || []; });
    }
    this.roleRotation++;
  }

  start(id) {
    if (id !== this.hostId || this.playing) return;
    if (this.mode === MODES.DUEL && this.players.size < 2) {
      return send(this.players.get(id).ws, { t: MSG.ERR, msg: 'Duel needs at least 2 players (one per mech)' });
    }
    this.assignCrews();
    this.assignRoles();
    this.game =
      this.mode === MODES.DUEL ? new DuelGame() :
      this.mode === MODES.TRAINING ? new TrainingGame() :
      new BrawlGame();

    for (const p of this.players.values()) {
      send(p.ws, {
        t: MSG.GAME_START,
        mode: this.mode,
        world: this.game.worldInfo(),
        roles: p.roles,
        crew: p.crew,
        players: this.playerList(),
      });
    }
    this.startLoop();
    this.broadcastRoom();
  }

  again(id) {
    if (id !== this.hostId || !this.game) return;
    this.stopLoop();
    this.game = null;
    this.start(id); // re-assigns roles (rotated) and starts a fresh game
  }

  input(id, data) {
    const p = this.players.get(id);
    if (!p || !this.game || !p.roles.length) return;
    this.game.applyInput(p.roles, data, ROLE, p.crew);
  }

  buy(id, item) {
    // Judgment call: ANY crew member can spend the shared credits. Chaos is content.
    if (this.game instanceof BrawlGame) {
      const res = this.game.buy(item);
      if (!res.ok) {
        const p = this.players.get(id);
        if (p) send(p.ws, { t: MSG.ERR, msg: res.reason });
      }
    }
  }

  shopDone(id) {
    if (id !== this.hostId) return;
    if (this.game instanceof BrawlGame) this.game.shopDone();
  }

  startLoop() {
    this.stopLoop();
    this.loop = setInterval(() => this.game?.step(), 1000 / PHYSICS_HZ);
    this.snapLoop = setInterval(() => {
      if (!this.game) return;
      const data = JSON.stringify({ t: MSG.STATE, ...this.game.snapshot() });
      for (const p of this.players.values()) {
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
      }
    }, 1000 / SNAPSHOT_HZ);
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    if (this.snapLoop) clearInterval(this.snapLoop);
    this.loop = this.snapLoop = null;
  }

  playerList() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, roles: p.roles, crew: p.crew, host: p.id === this.hostId,
    }));
  }

  sendRoles() {
    for (const p of this.players.values()) {
      send(p.ws, { t: MSG.ROOM, code: this.code, mode: this.mode, playing: this.playing, players: this.playerList(), you: p.id, rolesChanged: true });
    }
  }

  broadcastRoom() {
    for (const p of this.players.values()) {
      send(p.ws, { t: MSG.ROOM, code: this.code, mode: this.mode, playing: this.playing, players: this.playerList(), you: p.id });
    }
  }
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function cleanName(name) {
  const n = String(name || '').trim().slice(0, 16);
  return n || randomName();
}
const NAME_A = ['Captain', 'Doctor', 'Chief', 'Baron', 'Duchess', 'Sergeant', 'Professor', 'Admiral'];
const NAME_B = ['Wobble', 'Piston', 'Sprocket', 'Clank', 'Bolt', 'Gizmo', 'Crumble', 'Socket'];
function randomName() {
  return NAME_A[Math.floor(Math.random() * NAME_A.length)] + ' ' + NAME_B[Math.floor(Math.random() * NAME_B.length)];
}
