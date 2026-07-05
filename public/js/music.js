// Procedurally generated adaptive music (WebAudio, no files, no licensing).
// A tiny step sequencer in A minor at 112 BPM with three intensity states:
//   lobby — warm pad + slow arpeggio
//   wave  — add kick/snare/hats + driving bass (kaiju-movie synth)
//   boss  — add a detuned lead + double-time hats
// States crossfade via per-layer gain nodes.

const BPM = 112;
const STEP = 60 / BPM / 4;           // 16th notes
const SCALE = [110, 130.81, 146.83, 164.81, 196, 220, 261.63]; // A minor-ish
const BASS_LINE = [0, 0, 3, 0, 5, 0, 3, 2];                    // per half-bar
const ARP = [0, 4, 2, 6, 4, 2, 5, 4];
const LEAD = [7, 6, 4, 6, 2, 4, 6, 9];

class Music {
  constructor() {
    this.ctx = null;
    this.state = 'off';   // off | lobby | wave | boss
    this.step = 0;
    this.nextT = 0;
    this.timer = null;
    this.layers = {};
  }

  start(ctx, master) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.32;
    this.bus.connect(master);
    // a distortion curve gives the lead a snarling guitar/synth-hybrid edge
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 4); }
    shaper.curve = curve;
    shaper.connect(this.bus);
    for (const name of ['pad', 'arp', 'drums', 'bass', 'lead']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(name === 'lead' ? shaper : this.bus);
      this.layers[name] = g;
    }
    this.nextT = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 90);
  }

  // danger-driven continuous mix (0..1) + boss layer flag
  setIntensity(x, boss = false) {
    if (!this.ctx) return;
    this.state = boss ? 'boss' : 'wave';
    const t = this.ctx.currentTime;
    const g = this.layers;
    const tgt = {
      pad: 0.75 - 0.3 * x,
      arp: 0.4 + 0.3 * x,
      drums: x < 0.12 ? 0 : 0.35 + 0.65 * x,
      bass: x < 0.25 ? 0 : 0.3 + 0.6 * x,
      lead: boss ? 0.7 : 0,
    };
    for (const [k, v] of Object.entries(tgt)) {
      g[k].gain.cancelScheduledValues(t);
      g[k].gain.setTargetAtTime(v, t, 1.5);
    }
  }

  setState(state) {
    if (!this.ctx || state === this.state) return;
    this.state = state;
    const t = this.ctx.currentTime;
    const target = {
      off: {},
      lobby: { pad: 0.8, arp: 0.5 },
      shop: { pad: 0.8, arp: 0.7 },
      wave: { pad: 0.5, arp: 0.6, drums: 0.9, bass: 0.85 },
      boss: { pad: 0.4, arp: 0.55, drums: 1.0, bass: 0.9, lead: 0.7 },
    }[state] || {};
    for (const [name, g] of Object.entries(this.layers)) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(target[name] || 0, t, 1.2);
    }
  }

  schedule() {
    if (!this.ctx || this.state === 'off') return;
    while (this.nextT < this.ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextT);
      this.step = (this.step + 1) % 128;
      this.nextT += STEP;
    }
  }

  playStep(s, t) {
    const bar16 = s % 16;
    const half = Math.floor(s / 8) % 8;

    // pad: one warm chord per 2 bars
    if (s % 32 === 0) {
      const rootI = [0, 5, 3, 4][Math.floor(s / 32) % 4];
      for (const off of [0, 2, 4]) {
        this.tone('pad', SCALE[(rootI + off) % 7] * 1, t, STEP * 32, 'sawtooth', 0.10, 1.4);
        this.tone('pad', SCALE[(rootI + off) % 7] * 0.5, t, STEP * 32, 'triangle', 0.12, 1.4);
      }
    }
    // arpeggio: gentle 8ths
    if (s % 2 === 0) {
      this.tone('arp', SCALE[ARP[(s / 2) % 8]] * 2, t, STEP * 1.8, 'triangle', 0.16, 0.05);
    }
    // bass: driving 8ths following the line
    if (s % 2 === 0) {
      this.tone('bass', SCALE[BASS_LINE[half]] * 0.5, t, STEP * 1.6, 'square', 0.22, 0.02);
    }
    // drums
    if (bar16 % 4 === 0) this.kick(t);
    if (bar16 === 4 || bar16 === 12) this.snare(t);
    if (s % 2 === 1) this.hat(t, 0.5);
    if (this.state === 'boss' && s % 2 === 0) this.hat(t, 0.3); // double-time
    // lead: sparse dramatic phrase every 4 bars in boss
    if (this.state === 'boss' && s % 4 === 0 && Math.floor(s / 64) % 2 === 1) {
      const n = SCALE[LEAD[(s / 4) % 8] % 7] * 2;
      this.tone('lead', n, t, STEP * 3.4, 'sawtooth', 0.14, 0.03);
      this.tone('lead', n * 1.007, t, STEP * 3.4, 'sawtooth', 0.10, 0.03); // detune
    }
  }

  tone(layer, freq, t, dur, type, amp, attack) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.layers[layer]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.layers.drums);
    o.start(t); o.stop(t + 0.25);
  }

  snare(t) {
    const len = Math.floor(this.ctx.sampleRate * 0.12);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1400;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(f); f.connect(g); g.connect(this.layers.drums);
    src.start(t);
  }

  hat(t, amp) {
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = this.ctx.createGain(); g.gain.value = 0.25 * amp;
    src.connect(f); f.connect(g); g.connect(this.layers.drums);
    src.start(t);
  }
}

export const music = new Music();
