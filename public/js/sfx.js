// All sound is synthesized with WebAudio — no audio files, no loading,
// and it keeps the soundtrack original, lightweight, and deploy-safe.

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
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    // shared reverb send: big impacts bloom into the concrete canyon of the
    // ruined city instead of firing dry. Small UI blips stay dry (verb=0).
    this.reverbSend = null;
    try {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * 1.6);
      const ir = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.6);
      }
      const conv = this.ctx.createConvolver(); conv.buffer = ir;
      const wet = this.ctx.createGain(); wet.gain.value = 0.6;
      conv.connect(wet); wet.connect(this.master);
      this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 1;
      this.reverbSend.connect(conv);
    } catch (e) { /* no convolver: run dry */ }
    if (this._wantAmbience) { this._wantAmbience = false; this.setAmbience(true); }
  }

  now() { return this.ctx.currentTime; }

  env(node, t0, attack, peak, decay, verb = 0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.sfxGain || this.master);
    // parallel reverb send for weighty/impact sounds
    if (verb > 0 && this.reverbSend) {
      const s = this.ctx.createGain(); s.gain.value = verb;
      g.connect(s); s.connect(this.reverbSend);
    }
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

  // ---------------------------------------------------------- ambience
  // The storm as a sound bed: rain patter (filtered noise), gusting wind
  // (slow-LFO bandpass), and a deep city rumble. Starts with the run.
  setAmbience(on) {
    if (!this.ready()) { this._wantAmbience = on; return; }
    if (on && !this._amb) {
      const ctx = this.ctx;
      const bus = ctx.createGain();
      bus.gain.value = 0.0001;
      bus.connect(this.master);
      // 2s looped noise buffer shared by the layers
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
      const layer = (type, freq, q, gain) => {
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = gain;
        src.connect(f); f.connect(g); g.connect(bus);
        src.start();
        return { src, f, g };
      };
      const rain = layer('lowpass', 900, 0.4, 0.5);    // patter
      const wind = layer('bandpass', 300, 1.6, 0.0);   // gusts (LFO below)
      const rumble = layer('lowpass', 70, 0.5, 0.7);   // city groan
      // gust LFO sweeps the wind band + swells its gain
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05;
      const lfoF = ctx.createGain(); lfoF.gain.value = 160;
      lfo.connect(lfoF); lfoF.connect(wind.f.frequency);
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.22;
      lfo.connect(lfoG); lfoG.connect(wind.g.gain);
      wind.g.gain.value = 0.24;
      lfo.start();
      bus.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 2.5);
      this._amb = { bus, parts: [rain.src, wind.src, rumble.src, lfo] };
    } else if (!on && this._amb) {
      const a = this._amb;
      this._amb = null;
      try {
        a.bus.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 1.2);
        setTimeout(() => { for (const p of a.parts) { try { p.stop(); } catch {} } }, 1400);
      } catch {}
    }
  }

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
  thud(big = 1) { // footsteps: ground slam + armor rattle + deep sub
    if (!this.ready() || !this.gate('thud')) return;
    const t = this.now();
    const o = this.osc('sine', 52 * (big > 1 ? 0.8 : 1), t, 0.25);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.22);
    this.env(o, t, 0.005, 0.9 * big, 0.24, 0.22);
    const n = this.noise(t, 0.1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    n.connect(f);
    this.env(f, t, 0.002, 0.28 * big, 0.09);
    // armor plates settling: a delayed metallic tick
    const rattle = this.osc('sine', 480 + Math.random() * 180, t + 0.05, 0.05);
    this.env(rattle, t + 0.05, 0.002, 0.06 * big, 0.05);
  }

  whoosh() { // punch windup: air + hydraulic servo spooling
    if (!this.ready() || !this.gate('whoosh')) return;
    const t = this.now();
    const n = this.noise(t, 0.35);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.3);
    n.connect(f);
    this.env(f, t, 0.05, 0.3, 0.32);
    // servo whine under the swing
    const servo = this.osc('sawtooth', 190, t, 0.3);
    servo.frequency.exponentialRampToValueAtTime(760, t + 0.28);
    const sf = this.ctx.createBiquadFilter();
    sf.type = 'bandpass'; sf.Q.value = 6; sf.frequency.value = 900;
    servo.connect(sf);
    this.env(sf, t, 0.03, 0.12, 0.26);
  }

  clang(strong = 1) { // metal-on-chitin impact: inharmonic ring + sub punch
    if (!this.ready() || !this.gate('clang')) return;
    const t = this.now();
    // inharmonic partials = struck plate, not a video-game square wave
    const f0 = 150 + Math.random() * 40;
    for (const [ratio, amp, dec] of [[1, 0.55, 0.34], [1.42, 0.34, 0.26], [2.17, 0.22, 0.2], [3.36, 0.12, 0.13]]) {
      const o = this.osc('sine', f0 * ratio, t, dec + 0.05);
      o.frequency.exponentialRampToValueAtTime(f0 * ratio * 0.96, t + dec);
      this.env(o, t, 0.003, amp * strong, dec, 0.22);
    }
    // strike transient: bright filtered snap
    const n = this.noise(t, 0.09);
    const hf = this.ctx.createBiquadFilter();
    hf.type = 'highpass'; hf.frequency.value = 1400;
    n.connect(hf);
    this.env(hf, t, 0.001, 0.5 * strong, 0.07);
    // chest-deep sub thump
    const sub = this.osc('sine', 58, t, 0.32);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.28);
    this.env(sub, t, 0.004, 1.0 * strong, 0.3, 0.3);
  }

  ping() { // laser hitmarker
    if (!this.ready() || !this.gate('ping')) return;
    const t = this.now();
    const o = this.osc('sine', 1560, t, 0.09);
    this.env(o, t, 0.002, 0.22, 0.08);
  }

  splat(v = 1) { // spitter glob lands
    if (!this.ready() || !this.gate('splat', 2)) return;
    const t = this.now();
    const o = this.osc('sine', 220, t, 0.25);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    this.env(o, t, 0.005, 0.4 * v, 0.22);
    const n = this.noise(t, 0.18);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    n.connect(f);
    this.env(f, t, 0.004, 0.35 * v, 0.16);
  }

  screech(pitch = 1, v = 1) { // flyer dive
    if (!this.ready() || !this.gate('screech', 2)) return;
    const t = this.now();
    const o = this.osc('sawtooth', 900 * pitch, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(420 * pitch, t + 0.45);
    this.env(o, t, 0.02, 0.22 * v, 0.45);
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
    this.env(o, t, 0.02, 0.4, dur, 0.3);
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

  roar(pitch = 1, v = 1) { // monster spawn/telegraph
    if (!this.ready() || !this.gate('roar')) return;
    const t = this.now();
    const o = this.osc('sawtooth', 110 * pitch, t, 0.6);
    o.frequency.setValueAtTime(110 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.55);
    const lfo = this.osc('sine', 16, t, 0.6);
    const lg = this.ctx.createGain(); lg.gain.value = 30;
    lfo.connect(lg); lg.connect(o.frequency);
    this.env(o, t, 0.04, 0.4 * v, 0.55, 0.4);
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

  squish(v = 1) { // monster dies
    if (!this.ready() || !this.gate('squish')) return;
    const t = this.now();
    const o = this.osc('sine', 300, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.45);
    this.env(o, t, 0.01, 0.5 * v, 0.45, 0.3);
    const n = this.noise(t, 0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 800;
    n.connect(f);
    this.env(f, t, 0.01, 0.3 * v, 0.18);
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

  crash(big = 1) { // collapse/explosion: hot blast sweeping down to rumble
    if (!this.ready()) return;
    const t = this.now();
    this.thud(1.6 * big);
    const n = this.noise(t, 0.7);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.55);
    n.connect(f);
    this.env(f, t, 0.004, 0.7 * big, 0.6, 0.45);
    // debris crackle: a scatter of short ticks after the blast
    for (let i = 0; i < 5; i++) {
      const dt2 = 0.12 + Math.random() * 0.4;
      const tick = this.noise(t + dt2, 0.03);
      const tf = this.ctx.createBiquadFilter();
      tf.type = 'bandpass'; tf.frequency.value = 900 + Math.random() * 2200; tf.Q.value = 3;
      tick.connect(tf);
      this.env(tf, t + dt2, 0.002, 0.1 * big, 0.03);
    }
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
    this.env(f, t, 0.01, 0.4, 0.45, 0.3);
  }

  pop() { // balloon
    if (!this.ready()) return;
    const t = this.now();
    const n = this.noise(t, 0.08);
    this.env(n, t, 0.001, 0.6, 0.07);
  }

  thunder() { // distant storm — long low rumble with a sub drop
    if (!this.ready() || !this.gate('thunder', 1)) return;
    const t = this.now();
    const n = this.noise(t, 2.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(320, t);
    f.frequency.exponentialRampToValueAtTime(70, t + 2.0);
    n.connect(f);
    this.env(f, t, 0.15, 0.5, 2.0, 0.5);
    const sub = this.osc('sine', 46, t, 1.6);
    sub.frequency.exponentialRampToValueAtTime(26, t + 1.4);
    this.env(sub, t, 0.1, 0.35, 1.5, 0.4);
  }
}

export const sfx = new Sfx();
