// Integration test over real WebSockets: rooms, roles, sync, disconnects.
// Starts its own server on a test port. Run: node test/rooms.test.js
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3111;

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class TestClient {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.room = null;
    this.states = [];
    this.gameStart = null;
    this.errs = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}`);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (buf) => {
        const m = JSON.parse(buf);
        this.msgs.push(m);
        if (m.t === 'welcome') this.playerId = m.playerId;
        if (m.t === 'room') this.room = m;
        if (m.t === 'state') { this.states.push(m); if (this.states.length > 30) this.states.shift(); }
        if (m.t === 'gameStart') this.gameStart = m;
        if (m.t === 'err') this.errs.push(m.msg);
      });
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { this.ws.close(); }
  myRoles() {
    const me = this.room?.players.find((p) => p.id === this.playerId);
    return me?.roles || [];
  }
}

// --- boot a server ---
const server = spawn('node', [path.join(__dirname, '../server/index.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => console.error('[server]', String(d)));
await wait(1200);

try {
  // 1. create a room
  const a = new TestClient('Alice');
  await a.connect();
  a.send({ t: 'create', name: 'Alice' });
  await wait(300);
  check('room created with 4-letter code', /^[A-Z]{4}$/.test(a.room?.code || ''), `code=${a.room?.code}`);
  check('creator is host', a.room.players[0].host === true);

  // 2. join by code (and a bad code fails)
  const b = new TestClient('Bob');
  await b.connect();
  b.send({ t: 'join', code: 'XXXX', name: 'Bob' });
  await wait(300);
  check('bogus code rejected', b.errs.length === 1, b.errs[0]);
  b.send({ t: 'join', code: a.room.code, name: 'Bob' });
  await wait(300);
  check('join by code works', b.room?.code === a.room.code && b.room.players.length === 2);

  const c = new TestClient('Cleo');
  await c.connect();
  c.send({ t: 'join', code: a.room.code.toLowerCase(), name: 'Cleo' });
  await wait(300);
  check('lowercase code accepted', c.room?.players.length === 3);

  // 3. non-host cannot start; default is Classic, then switch to Endless for movement sync stability
  check('new rooms default to Classic Wave Mode', a.room?.mode === 'classic');
  b.send({ t: 'start' });
  await wait(300);
  check('non-host start ignored', !b.gameStart);
  a.send({ t: 'setMode', mode: 'brawl' });
  await wait(200);
  a.send({ t: 'start' });
  await wait(500);
  check('host start launches game for everyone', !!a.gameStart && !!b.gameStart && !!c.gameStart);
  check('world info includes city', a.gameStart.world.city.length > 10);

  // 4. roles: 3 players -> LEGS / ARMS / HEAD split, all distinct
  const roles = [a, b, c].map((cl) => cl.gameStart.roles);
  const flat = roles.flat();
  check('3-player split covers all 4 role slots', flat.length === 4 && new Set(flat).size === 4, JSON.stringify(roles));
  const legsClient = [a, b, c].find((cl) => cl.gameStart.roles.includes('LEGS'));
  const headClient = [a, b, c].find((cl) => cl.gameStart.roles.includes('HEAD'));
  check('LEGS and HEAD are different players', legsClient !== headClient);

  // 5. state sync: LEGS walks, everyone sees the same mech move
  await wait(500);
  const before = a.states.at(-1)?.mechs[0].p;
  const iv = setInterval(() => legsClient.send({ t: 'input', data: { move: { x: 0, z: -1 }, aimYaw: 0 } }), 33);
  await wait(2500);
  clearInterval(iv);
  legsClient.send({ t: 'input', data: { move: { x: 0, z: 0 } } });
  await wait(300);
  const posA = a.states.at(-1).mechs[0].p;
  const posB = b.states.at(-1).mechs[0].p;
  check('mech moved from LEGS input', Math.hypot(posA[0] - before[0], posA[2] - before[2]) > 4,
    `moved ${Math.hypot(posA[0] - before[0], posA[2] - before[2]).toFixed(1)}m`);
  check('all clients see the same mech (within interp slack)',
    Math.hypot(posA[0] - posB[0], posA[2] - posB[2]) < 2, `A=${posA} B=${posB}`);

  // 6. non-LEGS movement input is ignored (let the mech coast to a stop first)
  const armsClient = [a, b, c].find((cl) => cl.gameStart.roles.includes('ARM_L'));
  await wait(3000);
  const p0 = a.states.at(-1).mechs[0].p;
  const iv2 = setInterval(() => armsClient.send({ t: 'input', data: { move: { x: 1, z: 0 }, aimYaw: 0 } }), 33);
  await wait(1500);
  clearInterval(iv2);
  const p1 = a.states.at(-1).mechs[0].p;
  check('ARMS player cannot walk the mech', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 2.5,
    `drift=${Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(1)}m`);

  // 7. disconnect mid-game: roles merge into a teammate
  const leavingRoles = headClient.gameStart.roles;
  headClient.close();
  await wait(600);
  const survivors = [a, b, c].filter((cl) => cl !== headClient);
  const merged = survivors.some((cl) => {
    const me = cl.room.players.find((p) => p.id === cl.playerId);
    return me && leavingRoles.every((r) => me.roles.includes(r));
  });
  check('disconnected player roles merged into a teammate', merged,
    JSON.stringify(survivors.map((cl) => cl.room.players.map((p) => p.roles))));

  // 8. classic wave launches as the beginner default mode
  const cw = new TestClient('Classic'); await cw.connect();
  cw.send({ t: 'create', name: 'Classic' });
  await wait(300);
  cw.send({ t: 'start' });
  await wait(500);
  check('classic wave launches as default mode', cw.gameStart?.mode === 'classic' && cw.states.at(-1)?.wave === 1);
  cw.send({ t: 'pause', paused: true });
  await wait(250);
  check('solo classic settings pause freezes room snapshot', cw.states.at(-1)?.paused === true);
  cw.send({ t: 'pause', paused: false });
  await wait(250);
  check('solo classic settings resume unpauses room snapshot', cw.states.at(-1)?.paused === false);

  // 8. endless escalation launches separately
  const e0 = new TestClient('Endless'); await e0.connect();
  e0.send({ t: 'create', name: 'Endless' });
  await wait(300);
  e0.send({ t: 'setMode', mode: 'brawl' });
  await wait(200);
  e0.send({ t: 'start' });
  await wait(500);
  check('endless escalation launches as separate mode', e0.gameStart?.mode === 'brawl' && typeof e0.states.at(-1)?.danger === 'number');

  // 8. duel requires 2+, assigns crews
  const d1 = new TestClient('D1'); await d1.connect();
  d1.send({ t: 'create', name: 'D1' });
  await wait(300);
  d1.send({ t: 'setMode', mode: 'duel' });
  await wait(200);
  d1.send({ t: 'start' });
  await wait(300);
  check('solo duel rejected', d1.errs.some((e) => e.includes('2 players')) && !d1.gameStart);
  const d2 = new TestClient('D2'); await d2.connect();
  d2.send({ t: 'join', code: d1.room.code, name: 'D2' });
  await wait(300);
  d1.send({ t: 'start' });
  await wait(500);
  check('duel starts with 2 players', !!d1.gameStart && !!d2.gameStart);
  check('duel assigns opposing crews', d1.gameStart.crew !== d2.gameStart.crew,
    `${d1.gameStart.crew} vs ${d2.gameStart.crew}`);
  await wait(400);
  check('duel snapshot has two mechs', d1.states.at(-1)?.mechs.length === 2);

  // 9. training launches
  const t1 = new TestClient('T1'); await t1.connect();
  t1.send({ t: 'create', name: 'T1' });
  await wait(300);
  t1.send({ t: 'setMode', mode: 'training' });
  await wait(200);
  t1.send({ t: 'start' });
  await wait(500);
  check('training launches solo', t1.gameStart?.mode === 'training');
  check('training world has rings', t1.gameStart?.world.rings?.length === 3);

  // 10. AGAIN restarts with rotated roles
  const beforeRoles = JSON.stringify([a, b].map((cl) => cl.myRoles()));
  a.send({ t: 'again' });
  await wait(600);
  const afterRoles = JSON.stringify([a, b].map((cl) => cl.myRoles()));
  check('AGAIN restarts the run', a.msgs.filter((m) => m.t === 'gameStart').length >= 2);
  check('roles rotate between runs', beforeRoles !== afterRoles, `${beforeRoles} -> ${afterRoles}`);

  // 11. empty room is disposed (join after everyone left fails)
  const code = d1.room.code;
  d1.close(); d2.close();
  await wait(600);
  const e1 = new TestClient('E1'); await e1.connect();
  e1.send({ t: 'join', code, name: 'E1' });
  await wait(300);
  check('emptied room is gone', e1.errs.length === 1, e1.errs[0]);

  a.close(); b.close(); t1.close(); e1.close();
} catch (e) {
  console.error('TEST CRASH:', e);
  failures++;
} finally {
  server.kill();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
