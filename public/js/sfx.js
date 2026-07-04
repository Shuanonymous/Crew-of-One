// All sound is synthesized with WebAudio — no audio files, no loading,
// and it fits the goofy-cartoon tone better than stock samples would.

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  // must be called from a user gesture
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  now() { return this.ctx.currentTime; }

  env(node, t0, attack, peak, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  osc(type, freq, t0, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  noise(t0, dur) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.start(t0);
    return src;
  }

  ready() { return this.enabled && this.ctx; }

  // per-sound-type instance caps: max ~3 of any small sound in a 160 ms
  // window; big moments (crash, laserFire, fanfare, roar) always play.
  gate(name, cap = 3) {
    const now = performance.now();
    this._g = this._g || {};
    const list = (this._g[name] = (this._g[name] || []).filter((t) => now - t < 160));
    if (list.length >= cap) return false;
    list.push(now);
    return true;
  }

  // ------------------------------------------------------------ effects
  thud(big = 1) { // footsteps, landings
    if (!this.ready() || !this.gate('thud')) return;
    const t = this.now();
    const o = this.osc('sine', 52 * (big > 1 ? 0.8 : 1), t, 0.25);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.22);
    this.env(o, t, 0.005, 0.9 * big, 0.24);
    const n = this.noise(t, 0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    n.connect(f);
    this.env(f, t, 0.002, 0.25 * big, 0.09);
  }

  whoosh() { // punch windup
    if (!this.ready() || !this.gate('whoosh')) return;
    const t = this.now();
    const n = this.noise(t, 0.35);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.3);
    n.connect(f);
    this.env(f, t, 0.05, 0.35, 0.32);
  }

  clang(strong = 1) { // punch/kick lands — with a chest-deep sub layer
    if (!this.ready() || !this.gate('clang')) return;
    const t = this.now();
    for (const [freq, amp] of [[210, 0.7], [335, 0.4], [523, 0.25]]) {
      const o = this.osc('square', freq * (0.9 + Math.random() * 0.2), t, 0.3);
      this.env(o, t, 0.004, amp * strong, 0.28);
    }
    const sub = this.osc('sine', 55, t, 0.3);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.26);
    this.env(sub, t, 0.004, 0.9 * strong, 0.28);
    const n = this.noise(t, 0.12);
    this.env(n, t, 0.002, 0.5 * strong, 0.1);
  }

  ping() { // laser hitmarker
    if (!this.ready() || !this.gate('ping')) return;
    const t = this.now();
    const o = this.osc('sine', 1560, t, 0.09);
    this.env(o, t, 0.002, 0.22, 0.08);
  }

  splat() { // spitter glob lands
    if (!this.ready() || !this.gate('splat', 2)) return;
    const t = this.now();
    const o = this.osc('sine', 220, t, 0.25);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    this.env(o, t, 0.005, 0.4, 0.22);
    const n = this.noise(t, 0.18);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    n.connect(f);
    this.env(f, t, 0.004, 0.35, 0.16);
  }

  screech(pitch = 1) { // flyer dive
    if (!this.ready() || !this.gate('screech', 2)) return;
    const t = this.now();
    const o = this.osc('sawtooth', 900 * pitch, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(420 * pitch, t + 0.45);
    this.env(o, t, 0.02, 0.22, 0.45);
  }

  laserCharge(dur = 3) {
    if (!this.ready()) return;
    this.stopCharge();
    const t = this.now();
    const o = this.osc('sawtooth', 90, t, dur);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.85);
    o.connect(g); g.connect(this.master);
    this._charge = { o, g };
  }

  stopCharge() {
    if (this._charge) {
      try { this._charge.g.gain.exponentialRampToValueAtTime(0.0001, this.now() + 0.1); this._charge.o.stop(this.now() + 0.15); } catch {}
      this._charge = null;
    }
  }

  laserFire(dur = 1.4) {
    if (!this.ready()) return;
    this.stopCharge();
    const t = this.now();
    const o = this.osc('sawtooth', 220, t, dur);
    o.frequency.setValueAtTime(220, t);
    const lfo = this.osc('sine', 30, t, dur);
    const lg = this.ctx.createGain(); lg.gain.value = 60;
    lfo.connect(lg); lg.connect(o.frequency);
    this.env(o, t, 0.02, 0.4, dur);
    const n = this.noise(t, dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2000;
    n.connect(f);
    this.env(f, t, 0.02, 0.12, dur);
  }

  fizzle() {
    if (!this.ready()) return;
    this.stopCharge();
    const t = this.now();
    const o = this.osc('sawtooth', 400, t, 0.3);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.28);
    this.env(o, t, 0.01, 0.2, 0.28);
  }

  roar(pitch = 1) { // monster spawn/telegraph
    if (!this.ready() || !this.gate('roar')) return;
    const t = this.now();
    const o = this.osc('sawtooth', 110 * pitch, t, 0.6);
    o.frequency.setValueAtTime(110 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.55);
    const lfo = this.osc('sine', 16, t, 0.6);
    const lg = this.ctx.createGain(); lg.gain.value = 30;
    lfo.connect(lg); lg.connect(o.frequency);
    this.env(o, t, 0.04, 0.4, 0.55);
  }

  coo() { // pigeon. it's still a pigeon.
    if (!this.ready() || !this.gate('coo', 2)) return;
    const t = this.now();
    for (let i = 0; i < 3; i++) {
      const o = this.osc('sine', 480 - i * 60, t + i * 0.09, 0.09);
      o.frequency.exponentialRampToValueAtTime(300, t + i * 0.09 + 0.08);
      this.env(o, t + i * 0.09, 0.01, 0.25, 0.09);
    }
  }

  squish() { // monster dies
    if (!this.ready() || !this.gate('squish')) return;
    const t = this.now();
    const o = this.osc('sine', 300, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.45);
    this.env(o, t, 0.01, 0.5, 0.45);
    const n = this.noise(t, 0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 800;
    n.connect(f);
    this.env(f, t, 0.01, 0.3, 0.18);
  }

  hurt() { // mech takes a hit
    if (!this.ready() || !this.gate('hurt', 2)) return;
    const t = this.now();
    const o = this.osc('square', 140, t, 0.2);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    this.env(o, t, 0.005, 0.45, 0.18);
    const n = this.noise(t, 0.15);
    this.env(n, t, 0.003, 0.3, 0.13);
  }

  ding() { // credits
    if (!this.ready() || !this.gate('ding')) return;
    const t = this.now();
    const o = this.osc('sine', 880, t, 0.3);
    this.env(o, t, 0.005, 0.3, 0.28);
    const o2 = this.osc('sine', 1320, t + 0.07, 0.3);
    this.env(o2, t + 0.07, 0.005, 0.2, 0.26);
  }

  buy() {
    if (!this.ready()) return;
    const t = this.now();
    [523, 659, 784, 1046].forEach((f, i) => {
      const o = this.osc('triangle', f, t + i * 0.07, 0.18);
      this.env(o, t + i * 0.07, 0.005, 0.3, 0.16);
    });
  }

  click() {
    if (!this.ready()) return;
    const t = this.now();
    const o = this.osc('square', 700, t, 0.05);
    this.env(o, t, 0.002, 0.15, 0.05);
  }

  fanfare() { // wave clear / win
    if (!this.ready()) return;
    const t = this.now();
    [[392, 0], [523, 0.12], [659, 0.24], [784, 0.36], [1046, 0.5]].forEach(([f, dt]) => {
      const o = this.osc('triangle', f, t + dt, 0.35);
      this.env(o, t + dt, 0.01, 0.35, 0.33);
    });
  }

  sad() { // run over
    if (!this.ready()) return;
    const t = this.now();
    [[392, 0], [370, 0.35], [349, 0.7], [262, 1.05]].forEach(([f, dt]) => {
      const o = this.osc('triangle', f, t + dt, 0.4);
      this.env(o, t + dt, 0.02, 0.35, 0.38);
    });
  }

  crash(big = 1) { // mech falls over
    if (!this.ready()) return;
    const t = this.now();
    this.thud(1.6 * big);
    const n = this.noise(t, 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    n.connect(f);
    this.env(f, t, 0.005, 0.6 * big, 0.45);
  }

  rocket() {
    if (!this.ready()) return;
    const t = this.now();
    const n = this.noise(t, 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2000, t + 0.45);
    f.Q.value = 2;
    n.connect(f);
    this.env(f, t, 0.01, 0.4, 0.45);
  }

  pop() { // balloon
    if (!this.ready()) return;
    const t = this.now();
    const n = this.noise(t, 0.08);
    this.env(n, t, 0.001, 0.6, 0.07);
  }
}

export const sfx = new Sfx();
