import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
// Serve three.js straight out of node_modules — no build step needed.
app.use('/vendor/three.module.js', express.static(path.join(root, 'node_modules/three/build/three.module.js')));
app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const manager = new RoomManager();

wss.on('connection', (ws) => {
  const id = manager.connect(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf); } catch { return; }
    try { manager.handle(id, msg); } catch (e) { console.error('handle error:', e); }
  });
  ws.on('close', () => manager.disconnect(id));
  ws.on('error', () => {});
});

// Cull dead connections so crews don't wait on ghosts
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Crew of One server running: http://localhost:${PORT}`);
});
