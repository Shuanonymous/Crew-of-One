import { Net } from '/js/net.js';
import { Input } from '/js/input.js';
import { Renderer } from '/js/render.js';
import { sfx } from '/js/sfx.js';
import { music } from '/js/music.js';
import { ROLE, MODES, PHASE, SHOP, MSG, roleTitle, MECH } from '/shared/constants.js';

function audioOn() {
  if (window.__COO_NO_AUDIO) return; // E2E: avoid AudioContext limits across reloads
  // never let an audio failure (blocked autoplay, AudioContext limits,
  // privacy modes) break a UI action like creating a room
  try {
    sfx.unlock();
    if (sfx.ctx) music.start(sfx.ctx, sfx.master);
  } catch (e) { console.warn('audio unavailable:', e.message); }
}

// App flow: TITLE -> LOBBY -> GAME (hud + shop + end overlays) -> LOBBY...

const $ = (id) => document.getElementById(id);
const net = new Net();
const input = new Input(net);
const renderer = new Renderer($('game'));

function isBrawlLike(mode = state.mode) { return mode === MODES.BRAWL || mode === MODES.CLASSIC; }

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
  shopManual: false,
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
  if (screen === 'lobby' || screen === 'title' || screen === 'end') music.setState('lobby');
  if (screen === 'shop') music.setState('shop');
}

// hitstop: freeze the world for a few frames when something lands HARD
let freezeT = 0;
function hitstop(ms) { freezeT = Math.max(freezeT, ms / 1000); }

// dynamic mix: world sounds attenuate with distance from the camera, so a
// roar across the district reads as far away and one beside you fills the mix
function dv(p, ref = 35) {
  if (!p || !renderer.camPos) return 1;
  const c = renderer.camPos;
  const d = Math.hypot(p[0] - c.x, (p[1] || 0) - c.y, p[2] - c.z);
  return Math.max(0.12, Math.min(1, ref / Math.max(1, d)));
}

// floating damage numbers (DOM — crisp text, cheap, auto-cleaned)
function dmgNumber(p, dmg, cls = '') {
  const s = renderer.worldToScreen(p);
  if (!s) return;
  const el = document.createElement('div');
  el.className = 'dmg-num ' + cls;
  el.textContent = dmg;
  el.style.left = (s.x + (Math.random() - 0.5) * 40) + 'px';
  el.style.top = (s.y + (Math.random() - 0.5) * 16) + 'px';
  $('dmg-layer').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ------------------------------------------------------------- title
$('btn-create').onclick = () => {
  audioOn(); sfx.click();
  net.send({ t: 'create', name: $('name-input').value });
};
$('btn-join').onclick = joinFromInput;
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinFromInput(); });
$('name-input').addEventListener('keydown', (e) => {
  // Enter in the name field: join if a code is filled in, otherwise create
  if (e.key === 'Enter') ($('code-input').value.trim() ? joinFromInput() : $('btn-create').click());
});
function joinFromInput() {
  audioOn(); sfx.click();
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) return showError('Room codes are 4 letters');
  net.send({ t: 'join', code, name: $('name-input').value });
}
$('btn-howto').onclick = () => { audioOn(); sfx.click(); show('howto'); };
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
  try { sfx.setAmbience(false); } catch {}
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
  renderer.setPalette(0); // every run opens on the steel-rain grade
  try { sfx.setAmbience(true); } catch {}
  show('game');
  updateRoleBanner();
  $('wave-pill').classList.toggle('hidden', !isBrawlLike(msg.mode));
  $('credits-pill').classList.toggle('hidden', !isBrawlLike(msg.mode));
  $('btn-upgrades').classList.toggle('hidden', msg.mode !== MODES.BRAWL);
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
  audioOn();
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
  $('role-banner').style.setProperty('--rc', colors[title] || '#f5b13d');
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

const ROAR_PITCH = { crab: 0.9, rusher: 1.8, tank: 0.45, boss: 0.32, spitter: 1.2, swarmling: 2.4 };
const KILL_TEXT = {
  crab: 'CRAB CRACKED', pigeon: 'PIGEON DOWN', rusher: 'SCUTTLER SQUISHED',
  spitter: 'SPITTER SPLATTED', tank: 'TANK SCRAPPED', flyer: 'FLYER GROUNDED',
  swarmling: 'GRABLIN GONE', boss: 'BOSS DEFEATED!!',
};

function handleEvents(snap) {
  const mine = myMech(snap);
  for (const mech of snap.mechs) {
    const isMine = mech.id === mine.id;
    for (const ev of mech.ev || []) {
      switch (ev.what) {
        case 'step': if (isMine) { sfx.thud(1); renderer.shake(0.14); } else sfx.thud(0.5); break;
        case 'punchWindup': sfx.whoosh(); break;
        case 'punchHit': sfx.clang(1.1); renderer.shake(0.4); hitstop(80); renderer.burst(mech.p, '#f5d76e', 8); renderer.sparks(mech.p, 14); break;
        case 'punchMiss': break;
        case 'kickWindup': sfx.whoosh(); break;
        case 'kickHit':
          sfx.clang(1.7); renderer.shake(0.75); hitstop(110);
          renderer.burst(mech.p, '#f5d76e', 12); renderer.sparks(mech.p, 20, '#ffe2a8', 24); renderer.ring(mech.p, '#ffd9a0', 12, 0.5);
          toast('BOOT!');
          break;
        case 'kickMiss': if (isMine) toast('WHIFF'); break;
        case 'laserCharge': if (isMine) sfx.laserCharge(mech.up?.laser ? 1.7 : MECH.laser.chargeTime); break;
        case 'laserFire': sfx.laserFire(2.4); renderer.shake(0.55); break;
        case 'laserFizzle': if (isMine) { sfx.fizzle(); toast('FIZZLE…'); } break;
        case 'rocketFire': sfx.rocket(); break;
        case 'rocketHit': sfx.clang(1.3); renderer.shake(0.35); hitstop(70); if (ev.p) { renderer.ring(ev.p, '#f5d76e', 8, 0.4); renderer.sparks(ev.p, 12); } break;
        case 'hurt': if (isMine && (ev.dmg || 0) >= 3) { sfx.hurt(); renderer.shake(Math.min(0.9, 0.2 + (ev.dmg || 5) * 0.03)); } break;
        case 'fell': sfx.crash(1.5); renderer.shake(1.1); toast(pick(['TIMBER!', 'CLANG!', 'MECH DOWN!'])); renderer.dust(mech.p, 22); renderer.ring(mech.p, '#cbb9a0', 16, 0.7); break;
        case 'getUp': if (isMine) toast('BACK UP!'); break;
        case 'die': if (isMine) { renderer.shake(1.3); } break;
        case 'dmgNum': dmgNumber(ev.p, ev.dmg, ev.laser ? 'laser' : ev.dmg >= 30 ? 'big' : ''); if (ev.laser) sfx.ping(); break;
        case 'dash': sfx.whoosh(); renderer.ring(mech.p, '#8aa5ff', 10, 0.4); break;
        case 'turretFire': sfx.click(); if (ev.to) renderer.burst(ev.to, '#ffd166', 3, 8); break;
        case 'cannonFire': sfx.click(); renderer.shake(0.05); if (ev.p) renderer.muzzle(ev.p, '#fff2c0', 1.6); break;
        case 'podFire': sfx.rocket(); if (ev.p) { renderer.muzzle(ev.p, '#ffca8a', 2.2); renderer.smoke(ev.p); } break;
        case 'podHit': sfx.clang(1.4); renderer.shake(0.5); hitstop(70); if (ev.p) { renderer.muzzle(ev.p, '#ffd08a', 3.5); renderer.ring(ev.p, '#ff7b4d', 12, 0.5); renderer.burst(ev.p, '#ff7b4d', 22, 18); renderer.smoke(ev.p); renderer.smoke(ev.p); renderer.scorch(ev.p, 3); } break;
        case 'podReload': break;
      }
    }
  }
  for (const mon of snap.monsters || []) {
    for (const ev of mon.ev || []) {
      switch (ev.what) {
        case 'roar':
          if (mon.type === 'pigeon') sfx.coo();
          else if (mon.type === 'flyer') sfx.screech(1.2, dv(mon.p, 55));
          else sfx.roar(ROAR_PITCH[mon.type] || 0.9, dv(mon.p, mon.type === 'boss' ? 90 : 55));
          break;
        case 'telegraph':
          if (ev.kind === 'dive') sfx.screech(1, dv(mon.p, 55));
          else if (mon.type === 'pigeon') sfx.coo();
          else sfx.roar((ROAR_PITCH[mon.type] || 0.9) * 1.2, dv(mon.p, 55));
          break;
        case 'hit': renderer.flashMonster(mon.id); renderer.burst(mon.p, '#ffd166', 6, 10); break;
        case 'die': sfx.squish(dv(mon.p, 45)); renderer.burst(mon.p, '#e2543e', mon.type === 'boss' ? 40 : 20, 16); if (mon.type === 'boss') { renderer.ring(mon.p, '#ffd166', 24, 0.9); renderer.shake(1); } break;
        case 'gustHit': renderer.shake(0.7); toast('FLAP FLAP FLAP'); break;
        case 'slam': sfx.crash(2); renderer.shake(1.2); if (ev.p) renderer.ring(ev.p, '#ff7b5c', ev.range || 17, 0.8); break;
        case 'summon': toast('IT CALLED FOR BACKUP'); sfx.roar(1.5); break;
        case 'spit': sfx.splat(dv(mon.p, 40)); break;
        case 'latch': sfx.roar(2.6); break;
        case 'strikeHit': break;
      }
    }
  }
  for (const ev of snap.ev || []) {
    switch (ev.what) {
      case 'kill': sfx.ding(); toast(`+${ev.credits}© ${KILL_TEXT[ev.type] || 'KAIJU DOWN'}`); break;
      case 'runStart': banner(`SECTOR ${ev.seed} — SURVIVE`, 3000); break;
      case 'bossArrives': banner(`⚠ ${ev.name} ⚠`, 3800); sfx.roar(0.3); renderer.shake(0.8); break;
      case 'tankBoom': sfx.crash(1.8 * dv(ev.p, 60)); renderer.shake(0.8 * dv(ev.p, 60)); if (ev.p) { renderer.ring(ev.p, '#ff9d4d', 15, 0.7); renderer.burst(ev.p, '#ff9d4d', 26, 20); renderer.scorch(ev.p, 5); } break;
      case 'cacheOpen': sfx.buy(); toast(`SUPPLY CACHE +${ev.credits}©`); break;
      case 'pickup': sfx.ding(); break;
      case 'stationDown': toast('REPAIR STATION DESTROYED'); sfx.crash(1); break;
      case 'healing': sfx.ding(); break;
      case 'buy': sfx.buy(); toast(ev.item + '!'); break;
      case 'runOver': sfx.sad(); break;
      case 'duelOver': sfx.fanfare(); break;
      case 'ringDone': sfx.ding(); toast('RING!'); break;
      case 'balloonPop': sfx.pop(); toast('POP!'); break;
      case 'cratesToppled': sfx.clang(1.2); toast('TIMBERRR!'); break;
      case 'trainingDone': sfx.fanfare(); break;
      case 'splat': sfx.splat(dv(ev.p, 40)); if (ev.p) renderer.burst(ev.p, '#9dff5c', 10, 8); if (ev.hit) renderer.shake(0.4); break;
      case 'carHit': sfx.clang(0.7 * dv(ev.p, 35)); if (ev.p) { renderer.burst(ev.p, '#8ad6e6', 5, 12); renderer.sparks(ev.p, 8, '#bfe2ff', 14); } break;
      case 'bldgHit': if (ev.p) {
        renderer.dust(ev.p, 7);
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          renderer.debrisChunk(ev.p, [Math.cos(a) * 7, 5 + Math.random() * 6, Math.sin(a) * 7], 0.35 + Math.random() * 0.4);
        }
      } break;
      case 'bldgDown': renderer.collapseBuilding(ev.id, true); sfx.crash(1.7 * dv(ev.p, 70)); hitstop(60); break;
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
    renderer.setHurt?.(frac < 0.35 ? (0.35 - frac) / 0.35 : 0);
  }

  if (isBrawlLike()) {
    const mm = Math.floor(snap.runTime / 60), ss = String(Math.floor(snap.runTime % 60)).padStart(2, '0');
    $('wave-pill').textContent = state.mode === MODES.CLASSIC ? `WAVE ${snap.wave || 1} · ${snap.phase === PHASE.SHOP ? 'SHOP' : 'FIGHT'}` : `⚠ DANGER ${snap.danger.toFixed(1)} · ${mm}:${ss}`;
    if (snap.credits !== state.lastCredits) {
      state.lastCredits = snap.credits;
      $('credits-pill').textContent = '© ' + snap.credits;
      $('shop-credits').textContent = snap.credits;
    }
    // Classic auto-opens between waves. Endless is buy-anywhere via the UPGRADES button or B.
    const classicShop = state.mode === MODES.CLASSIC && snap.shopOpen;
    const endlessShop = state.mode === MODES.BRAWL && state.shopManual;
    if ((classicShop || endlessShop) && state.screen === 'game') {
      show('shop');
      state.shopKey = null;
    } else if (state.screen === 'shop' && !classicShop && !endlessShop) {
      show('game');
    }
    // REBUILD ONLY ON CHANGE. Rebuilding the button list every 50ms snapshot
    // destroyed the node between mousedown and mouseup, so clicks never
    // registered — the production shop bug. Guarded by e2e-shop.test.js.
    if (state.screen === 'shop') {
      const key = JSON.stringify([snap.credits, snap.prices, mine.up]);
      if (key !== state.shopKey) { state.shopKey = key; renderShopItems(snap); }
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

  // boss bar + adaptive music intensity
  if (snap.bossBar) {
    $('boss-bar').classList.remove('hidden');
    $('boss-name').textContent = snap.bossBar.name;
    $('boss-hp-fill').style.width = Math.max(0, snap.bossBar.hp / snap.bossBar.maxHp * 100) + '%';
  } else {
    $('boss-bar').classList.add('hidden');
  }
  if ((state.screen === 'game' || state.screen === 'shop') && snap.phase === PHASE.FIGHT) {
    if (isBrawlLike()) music.setIntensity(Math.min(1, (snap.danger || 0) / 8), !!snap.bossBar);
    else music.setState(snap.bossBar ? 'boss' : 'wave');
  }

  // laser scorch marks where the beam meets the street
  if (mine.laser.firing && mine.laser.to && mine.laser.to[1] < 2.5) {
    if (!state.lastScorch || performance.now() - state.lastScorch > 140) {
      state.lastScorch = performance.now();
      renderer.scorch(mine.laser.to, 2.2 + Math.random() * 1.4);
      renderer.burst(mine.laser.to, '#e2a8ff', 4, 10);
    }
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

  if (snap.phase === PHASE.DEAD && !state.endShown) {
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
  if (!isBrawlLike()) return;
  const mine = myMech(snap || net.latest() || { mechs: [] });
  const wrap = $('shop-items');
  wrap.innerHTML = '';
  for (const item of SHOP) {
    const btn = document.createElement('button');
    btn.className = 'shop-item';
    const up = mine?.up?.[item.id];
    const owned = typeof up === 'boolean' && up === true && !item.priceGrowth && !item.repeat;
    const tier = typeof up === 'number' && up > 0 ? ` [T${up}]` : '';
    const price = snap?.prices?.[item.id] ?? item.price;
    if (owned) btn.classList.add('owned');
    btn.disabled = owned || (snap && snap.credits < price);
    btn.innerHTML = `<b>${item.name}${tier}</b><span class="si-desc">${item.desc}</span>
      <span class="si-price">${owned ? 'INSTALLED ✓' : '© ' + price}</span>`;
    btn.onpointerdown = (e) => { e.preventDefault(); sfx.click(); net.send({ t: 'buy', item: item.id }); };
    wrap.appendChild(btn);
  }
  $('shop-title').textContent = state.mode === MODES.CLASSIC ? 'WAVE CLEARED — UPGRADE BAY' : 'ENDLESS UPGRADES';
  $('shop-sub').textContent = state.mode === MODES.CLASSIC ? 'Safe shop: spend shared credits, then the host clicks READY for the next wave.' : 'Endless shop: buy upgrades anywhere. The fight keeps moving behind this screen.';
  $('btn-shop-done').classList.toggle('hidden', !(state.mode === MODES.CLASSIC && state.isHost) && state.mode !== MODES.BRAWL);
  $('btn-shop-done').textContent = state.mode === MODES.CLASSIC ? 'READY FOR NEXT WAVE →' : 'BACK TO FIGHT';
  $('shop-hint').textContent = state.mode === MODES.CLASSIC ? 'Unaffordable upgrades are dimmed. Purchases apply immediately.' : 'Press B or BACK TO FIGHT to close. Purchases apply immediately.';
}
$('btn-shop-done').onclick = () => {
  sfx.click();
  if (state.mode === MODES.BRAWL) { closeShop(); return; }
  net.send({ t: 'shopDone' });
};
// Open/close the Endless upgrade overlay. Releasing pointer lock is
// essential — while locked the mouse is captured and shop items can't be
// clicked, which is what made the shop feel "broken".
function openShop() {
  if (state.mode !== MODES.BRAWL || state.screen === 'shop') return;
  sfx.click();
  state.shopManual = true;
  state.shopKey = null;
  if (document.pointerLockElement) document.exitPointerLock?.();
  show('shop');
  renderShopItems(net.latest());
}
function closeShop() {
  if (state.mode !== MODES.BRAWL) return;
  sfx.click();
  state.shopManual = false;
  show('game');
  $('click-catch').classList.remove('hidden'); // re-prompt to re-grab controls
}
$('btn-upgrades').onclick = openShop;

// ---------------------------------------------------------------- end
function showEnd(snap) {
  const s = snap.summary || {};
  try { sfx.setAmbience(false); } catch {}
  input.end();
  $('click-catch').classList.add('hidden');
  show('end');
  const stats = [];
  if (isBrawlLike()) {
    const mm = Math.floor((s.time || 0) / 60), ss = String((s.time || 0) % 60).padStart(2, '0');
    const bm = Math.floor((s.bestTime || 0) / 60), bs = String((s.bestTime || 0) % 60).padStart(2, '0');
    if (state.mode === MODES.CLASSIC) {
      $('end-title').textContent = 'MECH DOWN — CLASSIC WAVE MODE';
      $('end-big').textContent = `REACHED WAVE ${s.wave || 1}`;
    } else {
      $('end-title').textContent = 'HULL INTEGRITY ZERO — SECTOR ' + (s.seed || '?????');
      $('end-big').textContent = (s.newBest ? '★ NEW RECORD — ' : '') + `SURVIVED ${mm}:${ss}`;
    }
    stats.push([`${bm}:${bs}`, 'ROOM BEST'], [s.kills || 0, 'KAIJU DOWN'], [s.creditsEarned || 0, 'CREDITS EARNED'],
      [s.byPart?.ARMS || 0, 'DMG · ARMS'], [s.byPart?.LEGS || 0, 'DMG · LEGS'], [s.byPart?.HEAD || 0, 'DMG · HEAD']);
    if (s.byPart?.TURRET) stats.push([s.byPart.TURRET, 'DMG · TURRET']);
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

// ------------------------------------------------------------ pings
const pings = [];
net.onPing = (msg) => { pings.push({ ...msg, t: performance.now() }); sfx.ping(); };
window.addEventListener('keydown', (e) => {
  if (!state.playing || state.spectator) return;
  // B toggles the Endless upgrade shop from anywhere — even while
  // pointer-locked mid-fight (this was the missing handler; the "(B)"
  // label promised it but nothing listened). Guarded by an E2E keypress.
  if (e.code === 'KeyB' && state.mode === MODES.BRAWL) {
    e.preventDefault();
    if (state.screen === 'shop') { closeShop(); } else { openShop(); }
    return;
  }
  const snap = net.latest();
  const mine = snap && myMech(snap);
  if (!mine) return;
  if (e.code === 'KeyQ') {
    const p = mine.laser.aim || mine.p;
    net.send({ t: 'ping', p, kind: mine.laser.aimHit ? 'attack' : 'go' });
  } else if (e.code === 'KeyX') {
    net.send({ t: 'ping', p: mine.p, kind: 'danger' });
  }
});
const PING_LOOKS = { attack: ['⚔ ATTACK', '#ff5d5d'], go: ['▸ GO HERE', '#5cff8f'], danger: ['⚠ DANGER', '#ffd166'] };
function drawPings() {
  const layer = $('ping-layer');
  layer.innerHTML = '';
  const now = performance.now();
  const snap = net.latest();
  const mine = snap && state.playing ? myMech(snap) : null;
  for (const p of pings) {
    if (now - p.t > 6000) continue;
    const s = renderer.worldToScreen(p.p);
    if (!s) continue;
    const [label, color] = PING_LOOKS[p.kind] || PING_LOOKS.go;
    const dist = mine ? Math.round(Math.hypot(p.p[0] - mine.p[0], p.p[2] - mine.p[2])) : '';
    const el = document.createElement('div');
    el.className = 'ping-marker';
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; el.style.color = color;
    el.innerHTML = `${label}<span>${p.name}${dist !== '' ? ' · ' + dist + 'm' : ''}</span>`;
    layer.appendChild(el);
  }
  while (pings.length && now - pings[0].t > 6000) pings.shift();
}

// ---------------------------------------------------------- settings
const settings = { master: 0.5, music: 0.32, sfx: 1, sfxShake: 1, quality: 'medium', sens: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('coo-settings') || '{}')); } catch {}
function applySettings() {
  if (sfx.master) sfx.master.gain.value = settings.master;
  if (music.bus) music.bus.gain.value = settings.music;
  renderer.shakeMult = settings.sfxShake;
  renderer.setQuality?.(settings.quality);
  input.sensitivity = settings.sens;
  if (sfx.sfxGain) sfx.sfxGain.gain.value = settings.sfx;
  try { localStorage.setItem('coo-settings', JSON.stringify(settings)); } catch {}
}
function openSettings() {
  sfx.click();
  $('screen-settings').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock?.();
  if (state.playing) {
    net.send({ t: MSG.PAUSE, paused: true });
    $('settings-pause-note').textContent = 'Game paused. Close settings to resume the room.';
  } else {
    $('settings-pause-note').textContent = '';
  }
}
function closeSettings() {
  sfx.click();
  $('screen-settings').classList.add('hidden');
  applySettings();
  net.send({ t: MSG.PAUSE, paused: false });
}
$('btn-settings').onclick = openSettings;
$('btn-settings-close').onclick = closeSettings;
$('set-master').oninput = (e) => { settings.master = +e.target.value; applySettings(); };
$('set-music').oninput = (e) => { settings.music = +e.target.value; applySettings(); };
$('set-shake').onchange = (e) => { settings.sfxShake = +e.target.value; applySettings(); };
$('set-quality').onchange = (e) => { settings.quality = e.target.value; applySettings(); };
if ($('set-sens')) $('set-sens').oninput = (e) => { settings.sens = +e.target.value; applySettings(); };
if ($('set-sfxvol')) $('set-sfxvol').oninput = (e) => { settings.sfx = +e.target.value; applySettings(); };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !document.pointerLockElement && state.playing) {
    if ($('screen-settings').classList.contains('hidden')) openSettings(); else closeSettings();
  }
});

// --------------------------------------------------------- main loop
net.connect();
show('title');

let last = performance.now();
function frame(now) {
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // hitstop: the world holds its breath for a few frames on big impacts
  if (freezeT > 0) {
    freezeT -= dt;
    dt = 0;
  }
  if (state.playing) {
    if (dt > 0) {
      const sample = net.sample();
      if (sample) renderer.applySample(sample, dt, state.myMechId);
    }
    renderer.updateCamera(input.yaw, input.pitch, state.myMechId, Math.max(dt, 0.0001));
  } else {
    renderer.updateCamera(now / 9000, -0.28, null, Math.max(dt, 0.0001));
  }
  renderer.render();
  // thunder answers the horizon lightning a beat later
  if (renderer.thunderReady) { renderer.thunderReady = false; if (state.playing) sfx.thunder(); }
  drawPings();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// reflect persisted settings into the sliders
if ($('set-master')) $('set-master').value = settings.master;
if ($('set-music')) $('set-music').value = settings.music;
if ($('set-sens')) $('set-sens').value = settings.sens;
if ($('set-sfxvol')) $('set-sfxvol').value = settings.sfx;
if ($('set-quality')) $('set-quality').value = settings.quality;
applySettings();

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

// Test harness handle for automated browser checks; not shown in the UI.
window.__coo = { input, net, state, renderer, openSettings, closeSettings, openShop, closeShop };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
