import { Net } from '/js/net.js';
import { Input } from '/js/input.js';
import { Renderer } from '/js/render.js';
import { ROLE } from '/shared/constants.js';

const net = new Net();
const input = new Input(net);
const renderer = new Renderer(document.getElementById('game'));

const roleNameEl = document.getElementById('role-name');
const roleBannerEl = document.getElementById('role-banner');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');

const ROLE_LOOKS = {
  [ROLE.ALL]: { text: 'THE WHOLE CREW', color: '#ffb703' },
  [ROLE.LEGS]: { text: 'THE LEGS', color: '#2a9d8f' },
  [ROLE.ARMS]: { text: 'THE ARMS', color: '#e76f51' },
  [ROLE.HEAD]: { text: 'THE HEAD', color: '#9b5de5' },
};

net.onStatus = (s) => { statusEl.textContent = s; };

net.onWelcome = (msg) => {
  renderer.buildWorld(msg.world);
  const look = ROLE_LOOKS[msg.role] || ROLE_LOOKS[ROLE.ALL];
  roleNameEl.textContent = look.text;
  roleBannerEl.style.background = look.color;
};

let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 900);
}

net.onEvent = (ev) => {
  if (ev.what === 'fell') toast(pick(['CLANG!', 'TIMBER!', 'OOPS.', 'ROBOT DOWN!']));
  if (ev.what === 'respawn') toast(pick(['GOOD AS NEW', 'WALK IT OFF', 'REBOOTED']));
  if (ev.what === 'shove') toast('BONK!');
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

net.connect();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const sample = net.sample();
  if (sample) renderer.applySample(sample, dt);
  renderer.updateCamera(input.yaw, input.pitch);
  renderer.render();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
