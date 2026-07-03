import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { PHYSICS_HZ, SNAPSHOT_HZ, MSG, ROLE } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
// Serve three.js straight out of node_modules — no build step needed.
app.use('/vendor/three.module.js', express.static(path.join(root, 'node_modules/three/build/three.module.js')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Phase 1: a single shared game. (Phase 2 turns this into rooms.)
const game = new Game();
let nextPlayerId = 1;
const sockets = new Map(); // playerId -> ws

wss.on('connection', (ws) => {
  const playerId = 'p' + nextPlayerId++;
  sockets.set(playerId, ws);
  game.addPlayer(playerId, 'Pilot ' + playerId);

  ws.send(JSON.stringify({
    t: MSG.WELCOME,
    playerId,
    role: ROLE.ALL,
    world: game.worldInfo(),
  }));
  console.log(`[+] ${playerId} connected (${sockets.size} online)`);

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf); } catch { return; }
    if (msg.t === MSG.INPUT && msg.data) {
      game.applyInput(playerId, msg.data);
    }
  });

  ws.on('close', () => {
    sockets.delete(playerId);
    game.removePlayer(playerId);
    console.log(`[-] ${playerId} disconnected (${sockets.size} online)`);
  });
  ws.on('error', () => {});
});

// Physics loop: fixed timestep
setInterval(() => game.step(), 1000 / PHYSICS_HZ);

// Broadcast loop: send the world state to everyone
setInterval(() => {
  if (sockets.size === 0) return;
  const data = JSON.stringify({ t: MSG.STATE, ...game.snapshot() });
  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}, 1000 / SNAPSHOT_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Crew of One server running: http://localhost:${PORT}`);
});
