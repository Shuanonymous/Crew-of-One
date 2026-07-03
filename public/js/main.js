import { Net } from '/js/net.js';
import { Input } from '/js/input.js';
import { Renderer } from '/js/render.js';
import { sfx } from '/js/sfx.js';
import { ROLE, MODES, PHASE, SHOP, roleTitle, MECH } from '/shared/constants.js';

// App flow: TITLE -> LOBBY -> GAME (hud + shop + end overlays) -> LOBBY...

const $ = (id) => document.getElementById(id);
const net = new Net();
const input = new Input(net);
const renderer = new Renderer($('game'));

const state = {
  screen: 'title',
  room: null,          // latest room msg
  isHost: false,
  mode: MODES.BRAWL,
  playing: false,
  spectator: false,
  myRoles: [],
  myCrew: 'A',
  myMechId: 'mech1',
  lastPhase: null,
  lastWave: 0,
  lastCredits: 0,
  shopOpen: false,
  endShown: false,
  lastHp: -1,
};

// ------------------------------------------------------------- screens
function show(screen) {
  state.screen = screen;
  for (const s of ['screen-title', 'screen-howto', 'screen-lobby', 'screen-shop', 'screen-end']) {
    $(s).classList.toggle('hidden', s !== 'screen-' + screen);
  }
  $('hud').classList.toggle('hidden', screen !== 'game' && screen !== 'shop' && screen !== 'end');
}

// ------------------------------------------------------------- title
$('btn-create').onclick = () => {
  sfx.unlock(); sfx.click();
  net.send({ t: 'create', name: $('name-input').value });
};
$('btn-join').onclick = joinFromInput;
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinFromInput(); });
$('name-input').addEventListener('keydown', (e) => {
  // Enter in the name field: join if a code is filled in, otherwise create
  if (e.key === 'Enter') ($('code-input').value.trim() ? joinFromInput() : $('btn-create').click());
});
function joinFromInput() {
  sfx.unlock(); sfx.click();
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) return showError('Room codes are 4 letters');
  net.send({ t: 'join', code, name: $('name-input').value });
}
$('btn-howto').onclick = () => { sfx.unlock(); sfx.click(); show('howto'); };
$('btn-howto-back').onclick = () => { sfx.click(); show(state.room ? 'lobby' : 'title'); };

function showError(msg) {
  const el = state.screen === 'lobby' ? $('lobby-error') : $('title-error');
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 3500);
}

// auto-join via invite link (?room=CODE)
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('code-input').value = urlRoom.toUpperCase().slice(0, 4);

// ------------------------------------------------------------- lobby
net.onRoom = (msg) => {
  state.room = msg;
  state.isHost = msg.players.find((p) => p.id === net.playerId)?.host || false;
  state.mode = msg.mode;

  // room is not playing: everyone belongs in the lobby
  if (!msg.playing && state.screen !== 'howto') {
    if (state.playing) {
      state.playing = false;
      input.end();
    }
    show('lobby');
  }
  renderLobby();

  // mid-game role reshuffle (someone left)
  if (msg.playing && msg.rolesChanged) {
    const me = msg.players.find((p) => p.id === net.playerId);
    if (me && me.roles.length && JSON.stringify(me.roles) !== JSON.stringify(state.myRoles)) {
      state.myRoles = me.roles;
      input.roles = me.roles;
      updateRoleBanner();
      banner('CREWMATE LOST — YOU ARE NOW ' + roleTitle(me.roles), 2600);
      sfx.roar(1.4);
    }
  }
};

function renderLobby() {
  const msg = state.room;
  if (!msg) return;
  $('lobby-code').textContent = msg.code;
  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const p of msg.players) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = p.name + (p.id === net.playerId ? ' (you)' : '');
    const right = document.createElement('span');
    right.className = 'p-roles';
    right.textContent = p.host ? '★ HOST' : '';
    if (p.host) right.classList.add('p-host');
    li.append(left, right);
    ul.appendChild(li);
  }
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.mode === msg.mode);
    btn.disabled = !state.isHost;
  });
  $('mode-hint').textContent = state.isHost ? '(you pick!)' : '(host picks)';
  $('btn-start').disabled = !state.isHost;
  $('btn-start').textContent = state.isHost ? 'START' : 'WAITING FOR HOST…';
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.onclick = () => { sfx.click(); net.send({ t: 'setMode', mode: btn.dataset.mode }); };
});
$('btn-start').onclick = () => { sfx.click(); net.send({ t: 'start' }); };
$('btn-leave').onclick = () => {
  sfx.click();
  net.send({ t: 'leave' });
  state.room = null;
  show('title');
};
$('btn-copy-link').onclick = async () => {
  sfx.click();
  const url = `${location.origin}/?room=${state.room?.code}`;
  try {
    await navigator.clipboard.writeText(url);
    $('btn-copy-link').textContent = 'COPIED!';
  } catch {
    prompt('Copy this link:', url);
  }
  setTimeout(() => { $('btn-copy-link').textContent = 'COPY INVITE LINK'; }, 1500);
};

// --------------------------------------------------------- game start
net.onGameStart = (msg) => {
  state.playing = true;
  state.spectator = !!msg.spectator || !msg.roles?.length;
  state.myRoles = msg.roles || [];
  state.myCrew = msg.crew || 'A';
  state.myMechId = msg.mode === MODES.DUEL ? 'mech' + state.myCrew : 'mech1';
  state.mode = msg.mode;
  state.lastPhase = null;
  state.lastWave = 0;
  state.lastCredits = 0;
  state.endShown = false;
  state.lastHp = -1;

  renderer.buildWorld(msg.world);
  show('game');
  updateRoleBanner();
  $('wave-pill').classList.toggle('hidden', msg.mode !== MODES.BRAWL);
  $('credits-pill').classList.toggle('hidden', msg.mode !== MODES.BRAWL);
  $('duel-hp-wrap').classList.toggle('hidden', msg.mode !== MODES.DUEL);
  $('objectives').classList.toggle('hidden', msg.mode !== MODES.TRAINING);
  $('laser-wrap').classList.add('hidden');

  if (!state.spectator) {
    input.begin(state.myRoles, msg.mode === MODES.DUEL && state.myCrew === 'B' ? Math.PI / 2 : 0);
    $('click-role').textContent = 'YOU ARE ' + roleTitle(state.myRoles);
    $('click-desc').textContent = Input.keyHints(state.myRoles) + ' — click to take control';
    $('click-catch').classList.remove('hidden');
  } else {
    $('click-catch').classList.add('hidden');
    banner('SPECTATING — you join next round', 3000);
  }

  renderCrewmates(msg.players || []);
  if (state.mode === MODES.BRAWL) banner('WAVE 1 INCOMING…', 2500);
  if (state.mode === MODES.DUEL) banner('MECH DUEL — FIGHT!', 2500);
  if (state.mode === MODES.TRAINING) banner('TRAINING COURSE — GO!', 2500);
};

$('click-catch').onclick = () => {
  sfx.unlock();
  input.requestLock();
};

function updateRoleBanner() {
  const title = roleTitle(state.myRoles);
  $('role-name').textContent = title;
  $('role-keys').textContent = Input.keyHints(state.myRoles);
  const colors = {
    'THE LEGS': '#2a9d8f', 'THE ARMS': '#e76f51', 'THE LEFT ARM': '#e76f51',
    'THE RIGHT ARM': '#d1495b', 'THE HEAD': '#9b5de5', 'ARMS & HEAD': '#c78bd6',
    'THE WHOLE MECH': '#f5b13d',
  };
  $('role-banner').style.background = colors[title] || '#f5b13d';
  $('laser-wrap').classList.toggle('hidden', !state.myRoles.includes(ROLE.HEAD));
}

function renderCrewmates(players) {
  const el = $('crewmates');
  el.innerHTML = '';
  for (const p of players) {
    if (p.id === net.playerId || !p.roles?.length) continue;
    const div = document.createElement('div');
    div.className = 'mate';
    const crewTag = state.mode === MODES.DUEL ? `[${p.crew}] ` : '';
    div.innerHTML = `${crewTag}<b>${escapeHtml(p.name)}</b> · ${roleTitle(p.roles)}`;
    el.appendChild(div);
  }
}

// --------------------------------------------------------- snapshots
let banTimer = null;
function banner(text, ms = 2000) {
  const el = $('big-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(banTimer);
  banTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 900);
}

net.onSnapshot = (snap) => {
  if (!state.playing) return;
  handleEvents(snap);
  updateHud(snap);
  handlePhase(snap);
};

function myMech(snap) {
  return snap.mechs.find((m) => m.id === state.myMechId) || snap.mechs[0];
}

function handleEvents(snap) {
  const mine = myMech(snap);
  for (const mech of snap.mechs) {
    const isMine = mech.id === mine.id;
    for (const ev of mech.ev || []) {
      switch (ev.what) {
        case 'step': if (isMine) { sfx.thud(1); renderer.shake(0.16); } else sfx.thud(0.5); break;
        case 'punchWindup': sfx.whoosh(); break;
        case 'punchHit': sfx.clang(1); renderer.shake(0.35); renderer.burst(mech.p, '#f5d76e', 10); break;
        case 'punchMiss': break;
        case 'kickWindup': sfx.whoosh(); break;
        case 'kickHit': sfx.clang(1.6); renderer.shake(0.6); renderer.burst(mech.p, '#f5d76e', 16); toast('BOOT!'); break;
        case 'kickMiss': if (isMine) toast('WHIFF'); break;
        case 'laserCharge': if (isMine) sfx.laserCharge(mech.up?.laser ? 1.7 : MECH.laser.chargeTime); break;
        case 'laserFire': sfx.laserFire(); renderer.shake(0.5); break;
        case 'laserFizzle': if (isMine) { sfx.fizzle(); toast('FIZZLE…'); } break;
        case 'rocketFire': sfx.rocket(); break;
        case 'rocketHit': sfx.clang(1.3); renderer.shake(0.3); break;
        case 'hurt': if (isMine) { sfx.hurt(); renderer.shake(0.45); } break;
        case 'fell': sfx.crash(1.5); renderer.shake(1.0); toast(pick(['TIMBER!', 'CLANG!', 'MECH DOWN!'])); renderer.dust(mech.p, 18); break;
        case 'getUp': if (isMine) toast('BACK UP!'); break;
        case 'die': if (isMine) { renderer.shake(1.2); } break;
      }
    }
  }
  for (const mon of snap.monsters || []) {
    for (const ev of mon.ev || []) {
      switch (ev.what) {
        case 'roar': mon.type === 'pigeon' ? sfx.coo() : sfx.roar(0.9); break;
        case 'telegraph': mon.type === 'pigeon' ? sfx.coo() : sfx.roar(1.15); break;
        case 'hit': renderer.burst(mon.p, '#ef767a', 6, 9); break;
        case 'die': sfx.squish(); renderer.burst(mon.p, mon.type === 'pigeon' ? '#c6ccd6' : '#e2543e', 22, 16); break;
        case 'gustHit': renderer.shake(0.7); toast('FLAP FLAP FLAP'); break;
        case 'strikeHit': break;
      }
    }
  }
  for (const ev of snap.ev || []) {
    switch (ev.what) {
      case 'kill': sfx.ding(); toast(`+${ev.credits}© ${ev.type === 'pigeon' ? 'PIGEON DOWN' : 'CRAB CRACKED'}`); break;
      case 'waveStart': banner(`WAVE ${ev.wave} — ${ev.count} INCOMING`, 2600); (myMech(snap)) && sfx.roar(0.8); break;
      case 'waveClear': sfx.fanfare(); banner(`WAVE ${ev.wave} CLEAR!`, 2400); break;
      case 'buy': sfx.buy(); toast(ev.item + '!'); break;
      case 'runOver': sfx.sad(); break;
      case 'duelOver': sfx.fanfare(); break;
      case 'ringDone': sfx.ding(); toast('RING!'); break;
      case 'balloonPop': sfx.pop(); toast('POP!'); break;
      case 'cratesToppled': sfx.clang(1.2); toast('TIMBERRR!'); break;
      case 'trainingDone': sfx.fanfare(); break;
    }
  }
}

function updateHud(snap) {
  const mine = myMech(snap);
  if (!mine) return;

  if (mine.hp !== state.lastHp) {
    state.lastHp = mine.hp;
    const frac = Math.max(0, mine.hp / mine.maxHp);
    $('hp-fill').style.width = (frac * 100) + '%';
    $('hp-fill').classList.toggle('low', frac < 0.3);
  }

  if (state.mode === MODES.BRAWL) {
    if (snap.wave !== state.lastWave) {
      state.lastWave = snap.wave;
      $('wave-pill').textContent = 'WAVE ' + Math.max(1, snap.wave);
    }
    if (snap.credits !== state.lastCredits) {
      state.lastCredits = snap.credits;
      $('credits-pill').textContent = '© ' + snap.credits;
      $('shop-credits').textContent = snap.credits;
      renderShopItems(snap);
    }
  }

  if (state.mode === MODES.DUEL) {
    const enemy = snap.mechs.find((m) => m.id !== mine.id);
    if (enemy) $('duel-hp-fill').style.width = Math.max(0, enemy.hp / enemy.maxHp * 100) + '%';
  }

  if (state.myRoles.includes(ROLE.HEAD)) {
    const c = mine.laser.firing ? 1 : mine.laser.charge;
    $('laser-fill').style.width = (c * 100) + '%';
  }

  if (state.mode === MODES.TRAINING && snap.objectives) {
    const o = snap.objectives;
    $('objectives').innerHTML = [
      li(o.rings.every(Boolean), `🟡 Walk the rings (${o.rings.filter(Boolean).length}/${o.rings.length})`),
      li(o.dummies === 0, `👊 Bop the cardboard kaiju (${2 - o.dummies}/2)`),
      li(o.crates, `🦵 Kick over the crate tower`),
      li(o.balloon, `👁 Laser the balloon`),
      `⏱ ${snap.trainingTime}s`,
    ].join('<br>');
  }
}
function li(done, text) { return done ? `<span class="done">${text}</span>` : text; }

function handlePhase(snap) {
  if (snap.phase === state.lastPhase) {
    if (state.shopOpen) $('shop-timer').textContent = Math.ceil(snap.phaseT);
    return;
  }
  const prev = state.lastPhase;
  state.lastPhase = snap.phase;

  if (snap.phase === PHASE.SHOP && state.mode === MODES.BRAWL) {
    state.shopOpen = true;
    // wave 0 = pre-run "get ready" pause: skip the shop UI, just show a banner
    if (snap.wave === 0) {
      state.shopOpen = false;
      return;
    }
    show('shop');
    renderShopItems(snap);
    $('btn-shop-done').classList.toggle('hidden', !state.isHost);
    $('click-catch').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock?.();
  } else if (state.shopOpen && snap.phase === PHASE.FIGHT) {
    state.shopOpen = false;
    show('game');
    if (!state.spectator) $('click-catch').classList.remove('hidden');
  } else if (snap.phase === PHASE.DEAD && !state.endShown) {
    state.endShown = true;
    showEnd(snap);
  } else if (snap.phase === PHASE.WIN && !state.endShown) {
    state.endShown = true;
    showEnd(snap);
  } else if (snap.phase === PHASE.FIGHT && prev === null) {
    // fresh game
    show('game');
  }
}

// --------------------------------------------------------------- shop
function renderShopItems(snap) {
  if (state.mode !== MODES.BRAWL) return;
  const mine = myMech(snap || net.latest() || { mechs: [] });
  const wrap = $('shop-items');
  wrap.innerHTML = '';
  for (const item of SHOP) {
    const btn = document.createElement('button');
    btn.className = 'shop-item';
    const owned = !item.repeat && mine?.up?.[item.id];
    if (owned) btn.classList.add('owned');
    btn.disabled = owned || (snap && snap.credits < item.price);
    btn.innerHTML = `<b>${item.name}</b><span class="si-desc">${item.desc}</span>
      <span class="si-price">${owned ? 'OWNED ✓' : '© ' + item.price}</span>`;
    btn.onclick = () => { sfx.click(); net.send({ t: 'buy', item: item.id }); };
    wrap.appendChild(btn);
  }
  $('shop-hint').textContent = state.isHost ? '' : 'Host can start the next wave early';
}
$('btn-shop-done').onclick = () => { sfx.click(); net.send({ t: 'shopDone' }); };

// ---------------------------------------------------------------- end
function showEnd(snap) {
  const s = snap.summary || {};
  input.end();
  $('click-catch').classList.add('hidden');
  show('end');
  const stats = [];
  if (state.mode === MODES.BRAWL) {
    $('end-title').textContent = 'THE MECH IS DOWN';
    $('end-big').textContent = `MADE IT TO WAVE ${s.wave || 1}`;
    stats.push([s.kills || 0, 'KAIJU BONKED'], [s.creditsEarned || 0, 'CREDITS EARNED'],
      [s.punches || 0, 'PUNCHES'], [s.kicks || 0, 'KICKS'], [s.lasers || 0, 'LASERS'], [s.falls || 0, 'FACEPLANTS']);
  } else if (state.mode === MODES.DUEL) {
    const won = s.winner === state.myCrew;
    $('end-title').textContent = 'DUEL OVER';
    $('end-big').textContent = state.spectator ? `CREW ${s.winner} WINS!` : won ? 'YOUR CREW WINS! 🏆' : 'YOUR MECH EXPLODED';
    stats.push([s.damageA || 0, 'CREW A DAMAGE'], [s.damageB || 0, 'CREW B DAMAGE']);
  } else {
    $('end-title').textContent = 'TRAINING COMPLETE';
    $('end-big').textContent = `${s.time || 0} SECONDS`;
    stats.push([s.time || 0, 'SECONDS'], [s.falls || 0, 'FACEPLANTS']);
  }
  $('end-stats').innerHTML = stats.map(([v, l]) => `<div class="end-stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('btn-again').classList.toggle('hidden', !state.isHost);
  $('btn-end-lobby').classList.toggle('hidden', !state.isHost);
  $('end-hint').textContent = state.isHost
    ? 'Roles will shuffle!'
    : 'Waiting for the host… (roles will shuffle)';
}

$('btn-again').onclick = () => { sfx.click(); net.send({ t: 'again' }); };
$('btn-end-lobby').onclick = () => {
  sfx.click();
  net.send({ t: 'toLobby' }); // host: brings the whole room back
};

// ------------------------------------------------------------ errors
net.onErr = (msg) => {
  if (state.screen === 'title' || state.screen === 'lobby') showError(msg);
  else toast(msg);
};
net.onStatus = (s) => {
  $('conn-status').textContent = s;
  $('conn-status').classList.toggle('hidden', !s);
};

// --------------------------------------------------------- main loop
net.connect();
show('title');

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.playing) {
    const sample = net.sample();
    if (sample) renderer.applySample(sample, dt, state.myMechId);
    renderer.updateCamera(input.yaw, input.pitch, state.myMechId, dt);
  } else {
    // idle title-screen camera: slow orbit over the (empty or last) city
    renderer.updateCamera(now / 9000, -0.28, null, dt);
  }
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A little city to look at behind the title screen
fetchTitleCity();
async function fetchTitleCity() {
  // build a fake city locally so the title isn't a void — same builder
  // shapes, but purely decorative
  renderer.buildWorld({
    city: titleCity(),
    arenaRadius: 48,
  });
}
function titleCity() {
  const defs = [{ kind: 'ground', size: [320, 2, 320], p: [0, -1, 0], color: '#3d4155' },
    { kind: 'disc', size: [52], p: [0, 0.02, 0], color: '#4a4f68' }];
  const palette = ['#f2a65a', '#ef767a', '#7d9df0', '#6fc2a0', '#c78bd6', '#f5d76e'];
  let i = 0;
  for (let ring = 0; ring < 2; ring++) {
    const r = 58 + ring * 16;
    const count = 15 + ring * 4;
    for (let n = 0; n < count; n++) {
      const a = (n / count) * Math.PI * 2 + ring;
      const h = 10 + ((n * 7 + ring * 13) % 22);
      defs.push({
        kind: 'building',
        size: [8 + (n % 4) * 2, h, 8 + ((n + ring) % 3) * 2],
        p: [Math.cos(a) * r, h / 2, Math.sin(a) * r],
        yaw: 0, color: palette[i++ % palette.length], windows: true,
      });
    }
  }
  return defs;
}

// Debug/testing handle. It's a party game — "cheating" is just comedy.
window.__coo = { input, net, state, renderer };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
