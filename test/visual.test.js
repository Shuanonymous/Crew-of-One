// VISUAL ACCEPTANCE SUITE — captures the documented review screenshots into
// docs/visual-review/. Run: node test/visual.test.js
// Uses the same test-only hooks as the E2E gate (COO_TEST_CREDITS/SPAWN —
// never set in production).
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { chromium } from 'playwright-core';

const PORT = 3477;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'];
const OUT = new URL('../docs/visual-review/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), COO_TEST_CREDITS: '5000', COO_TEST_SPAWN: '10' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await wait(1400);

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { window.__COO_NO_AUDIO = true; });

const shot = async (name) => {
  await page.screenshot({ path: OUT + name + '.png' });
  console.log('shot:', name);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__coo?.net.playerId, { timeout: 20000 });
await wait(3000);
await shot('01-title');

// ---- hangar ----
await page.fill('#name-input', 'ReviewPilot');
await page.click('#btn-create');
await page.waitForFunction(() => window.__coo.state.loadout, { timeout: 8000 });
await wait(2200);
await shot('02-hangar-default');

// customize: heavy siege build with visible ordnance + vermilion scheme
const send = (op, layer, value) =>
  page.evaluate(([op, layer, value]) => window.__coo.net.send({ t: 'loadout', op, layer, value }), [op, layer, value]);
await send('set', 'frame', 'bastion');
await send('set', 'armR', 'piledriver');
await send('set', 'armL', 'bulwark');
await send('set', 'shoulderL', 'hydra');
await send('set', 'shoulderR', 'sentry');
await send('set', 'armorKit', 'siege');
await send('set', 'legs', 'colossus');
await send('set', 'head', 'talon');
await page.evaluate(() => window.__coo.net.send({
  t: 'loadout', op: 'set', layer: 'paint',
  value: { primary: '#8a4238', secondary: '#4a2a26', accent: '#d8c06a', emissive: '#ffb13f', finish: 0.4, weathering: 0.55 },
}));
await page.evaluate(() => { window.__coo.state.hgTab = 'ORDNANCE'; });
await wait(1800);
await shot('03-hangar-customized');

// ---- deploy: endless ----
await page.evaluate(() => window.__coo.net.send({ t: 'setMode', mode: 'brawl' }));
await wait(300);
await page.click('#btn-start');
await page.waitForFunction(() => window.__coo.state.playing, { timeout: 15000 });
await page.evaluate(() => document.getElementById('click-catch').classList.add('hidden'));
// deterministic weather for the review shots
await page.evaluate(() => window.__coo.renderer.setWeather('storm', true));
await wait(3500);
await shot('04-city-spawn-storm');
await page.evaluate(() => window.__coo.renderer.setWeather('golden', true));
await wait(1500);
await shot('05-weather-golden');
await page.evaluate(() => window.__coo.renderer.setWeather('rain', true));
await wait(1200);

// ---- combat: melee mid-swing ----
await page.evaluate(() => window.__coo.net.sendInput({ punchR: true }));
await wait(420);   // windup 0.34s -> active frames
await shot('06-melee-swing');
await page.evaluate(() => window.__coo.net.sendInput({ punchR: false }));

// ---- combat: rockets (hydra equipped from the hangar) ----
await page.evaluate(() => window.__coo.net.sendInput({ launch: true }));
await wait(120);
await page.evaluate(() => window.__coo.net.sendInput({ launch: false }));
await page.evaluate(() => window.__coo.net.sendInput({ launch: true }));
await wait(450);
await shot('07-rocket-launch');
await page.evaluate(() => window.__coo.net.sendInput({ launch: false }));

// ---- combat: beam (charge 3s then fires 2.4s) ----
await page.evaluate(() => window.__coo.net.sendInput({ fire: true, aimPitch: 0.04 }));
await wait(3300);
await shot('08-beam-firing');
await page.evaluate(() => window.__coo.net.sendInput({ fire: false }));

// ---- shop with live upgrade preview ----
await page.keyboard.press('b');
await page.waitForSelector('.shop-item', { timeout: 5000 });
// hover via dispatched pointerenter — the list re-renders on credit changes,
// which detaches handles mid-hover
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.shop-item')].find((b) => /COMPOSITE/.test(b.textContent));
  el?.dispatchEvent(new PointerEvent('pointerenter'));
});
await wait(700);
await shot('11-shop-upgrade-preview');

// ---- buy the arsenal: every upgrade physically lands on the mech ----
const buy = (id) => page.evaluate((id) => window.__coo.net.send({ t: 'buy', item: id }), id);
for (const id of ['armor', 'armor', 'armor', 'armor', 'dmg', 'dmg', 'speed', 'speed', 'laser', 'cannon', 'turret', 'dash', 'rocket']) {
  await buy(id);
  await wait(120);
}
await page.keyboard.press('b');   // close shop
await page.evaluate(() => document.getElementById('click-catch').classList.add('hidden'));
// swing the camera to the mech's front so the new hardware reads clearly
await page.evaluate(() => { window.__coo.input.yaw = Math.PI * 0.82; window.__coo.input.pitch = -0.06; });
await wait(1600);
await shot('12-upgraded-mech');
await page.evaluate(() => { window.__coo.input.yaw = 0; window.__coo.input.pitch = 0; });

// ---- monsters in frame ----
await wait(6000);
await shot('09-monsters');

// ---- boss (test-only summon) ----
await page.evaluate(() => window.__coo.net.send({ t: 'testBoss' }));
await wait(2600);
await shot('10-boss');

// ---- run summary (client wiring, same as the E2E gate) ----
await page.evaluate(() => {
  const net = window.__coo.net, base = net.latest();
  net.onSnapshot({
    ...base, phase: 'dead',
    summary: { time: 214, bestTime: 214, newBest: true, seed: base.seed || 'ABCDE', kills: 31, creditsEarned: 780, byPart: { ARMS: 300, LEGS: 120, HEAD: 260, TURRET: 40 }, falls: 2, dangerLevel: 3, purchases: ['COMPOSITE PLATING'] },
  });
});
await wait(600);
await shot('13-run-summary');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no console errors');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
