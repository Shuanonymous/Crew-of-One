import { BrawlGame } from './brawl.js';
import { Monster } from './monsters.js';
import { PHASE, SHOP } from '../shared/constants.js';

const WAVE_BREAK_SEC = 30;
const WAVE_BONUS_BASE = 25;
const WAVE_RECIPES = [
  ['rusher', 'rusher', 'crab'],
  ['rusher', 'rusher', 'rusher', 'crab', 'spitter'],
  ['crab', 'crab', 'spitter', 'flyer'],
  ['rusher', 'rusher', 'swarmling', 'swarmling', 'spitter', 'pigeon'],
  ['tank', 'crab', 'spitter', 'flyer', 'boss'],
];

export class ClassicWaveGame extends BrawlGame {
  constructor(bestWave = 0, build = null) {
    super(0, build);
    this.mode = 'classic';
    this.wave = 0;
    this.bestWave = bestWave;
    this.phase = PHASE.SHOP;
    this.phaseT = 6;
    this.ready = false;
    this.pendingBonus = 0;
    this.events = [{ what: 'classicStart', seed: this.seed }, { what: 'waveCleared', wave: 0, bonus: 0 }];
    this.startNextWave();
  }

  startNextWave() {
    this.wave++;
    this.phase = PHASE.FIGHT;
    this.phaseT = 0;
    this.ready = false;
    this.spawnWave(this.wave);
    this.events.push({ what: 'waveStart', wave: this.wave });
  }

  spawnWave(wave) {
    const recipe = recipeFor(wave);
    const ring = 42 + Math.min(30, wave * 2);
    recipe.forEach((type, i) => {
      const a = (i / recipe.length) * Math.PI * 2 + wave * 0.51;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      const m = new Monster(this.world, type, { x, z }, wave);
      this.monsters.push(m);
    });
  }

  buy(itemId) {
    if (this.phase !== PHASE.SHOP) return { ok: false, reason: 'shop opens between waves' };
    const item = SHOP.find((s) => s.id === itemId);
    if (!item) return { ok: false, reason: 'unknown item' };
    const up = this.mech.upgrades;
    const owned = !item.repeat && !(item.priceGrowth) && up[itemId] === true;
    if (owned) return { ok: false, reason: 'already installed' };
    const price = this.priceOf(item);
    if (this.credits < price) return { ok: false, reason: 'insufficient credits' };
    this.credits -= price;
    this.buyCounts[itemId] = (this.buyCounts[itemId] || 0) + 1;
    if (itemId === 'repair') this.mech.heal(50);
    else if (typeof up[itemId] === 'number') up[itemId]++;
    else up[itemId] = true;
    this.purchases.push(item.name);
    this.events.push({ what: 'buy', item: item.name });
    return { ok: true };
  }

  // test-only: jump straight to the safe shop phase
  forceShop() {
    for (const m of this.monsters) { m.hp = 0; m.removed = true; try { this.world.removeBody(m.body); } catch {} }
    this.monsters = [];
    this.phase = PHASE.SHOP;
    this.phaseT = 999;
    this.ready = false;
  }

  shopDone() {
    if (this.phase === PHASE.SHOP) {
      this.ready = true;
      this.phaseT = Math.min(this.phaseT, 2);
      this.events.push({ what: 'readyNextWave' });
    }
  }

  stepSpawner() {}

  step() {
    const prevPhase = this.phase;
    super.step();
    if (this.phase === PHASE.DEAD) return;

    const dt = 1 / 60;
    if (prevPhase === PHASE.SHOP || this.phase === PHASE.SHOP) {
      this.phase = PHASE.SHOP;
      this.phaseT = Math.max(0, this.phaseT - dt);
      // keep the world calm between waves; remove stray projectiles and pickups keep working from super
      this.monsters = this.monsters.filter((m) => m.alive && !m.removed);
      if (this.phaseT <= 0 || this.ready) this.startNextWave();
      return;
    }

    if (this.phase === PHASE.FIGHT && this.monsters.every((m) => !m.alive || m.removed)) {
      const bonus = WAVE_BONUS_BASE + this.wave * 15;
      this.credits += bonus;
      this.creditsEarned += bonus;
      this.pendingBonus = bonus;
      this.phase = PHASE.SHOP;
      this.phaseT = WAVE_BREAK_SEC;
      this.ready = false;
      this.projectiles = [];
      this.events.push({ what: 'waveCleared', wave: this.wave, bonus });
    }
  }

  get summary() {
    return { ...super.summary, wave: this.wave, bestWave: Math.max(this.bestWave, this.wave), purchases: this.purchases };
  }

  worldInfo() { return { ...super.worldInfo(), mode: 'classic' }; }

  snapshot() {
    const snap = super.snapshot();
    snap.mode = 'classic';
    snap.wave = this.wave;
    snap.bestWave = Math.max(this.bestWave, this.wave);
    snap.phaseT = Math.round(this.phaseT * 10) / 10;
    snap.shopOpen = this.phase === PHASE.SHOP;
    snap.shopSafe = this.phase === PHASE.SHOP;
    snap.ready = this.ready;
    snap.prices = Object.fromEntries(SHOP.map((it) => [it.id, this.priceOf(it)]));
    return snap;
  }
}

function recipeFor(wave) {
  if (wave <= WAVE_RECIPES.length) return WAVE_RECIPES[wave - 1];
  const out = [];
  const count = Math.min(22, 5 + wave * 2);
  const pool = wave % 5 === 0 ? ['rusher', 'crab', 'spitter', 'flyer', 'tank', 'boss'] : ['rusher', 'rusher', 'crab', 'spitter', 'flyer', 'pigeon', 'tank'];
  for (let i = 0; i < count; i++) out.push(pool[(i + wave) % pool.length]);
  if (wave % 5 === 0 && !out.includes('boss')) out.push('boss');
  return out;
}
