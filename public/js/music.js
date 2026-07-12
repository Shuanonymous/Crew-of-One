// Procedurally generated adaptive score (WebAudio, no files, all original).
// Direction: heavy and mechanical — deep sub bass, war-drum toms, metallic
// industrial hits, low synthetic BRASS swells for the heroic motif, and a
// snarling lead reserved for bosses. States:
//   lobby/hangar — quiet pad + sparse arp + distant brass (pre-deployment)
//   wave         — drums/bass/brass build continuously with the danger clock
//   boss         — full kit, double-time hats, war-tom fills, lead motif
// States crossfade via per-layer gain nodes.

const BPM = 96;
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
    // cinematic space: a convolver reverb fed by the sustained/melodic layers,
    // so pads and leads bloom into a big hall instead of sitting dry and thin
    this.reverbSend = null;
    try {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * 2.8);
      const ir = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.85;
      conv.connect(wet); wet.connect(this.bus);
      this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.38;
      this.reverbSend.connect(conv);
    } catch (e) { /* no convolver: run dry */ }
    // low synthetic brass: detuned saw stack through a dark lowpass
    this.brassFilter = ctx.createBiquadFilter();
    this.brassFilter.type = 'lowpass';
    this.brassFilter.frequency.value = 620;
    this.brassFilter.Q.value = 0.9;
    this.brassFilter.connect(this.bus);
    for (const name of ['pad', 'arp', 'drums', 'bass', 'lead', 'brass', 'metal']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(name === 'lead' ? shaper : name === 'brass' ? this.brassFilter : this.bus);
      // melodic layers also feed the reverb bus for cinematic depth
      if (this.reverbSend && ['pad', 'arp', 'lead', 'brass', 'metal'].includes(name)) g.connect(this.reverbSend);
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
      arp: 0.35 + 0.25 * x,
      drums: x < 0.12 ? 0 : 0.35 + 0.65 * x,
      bass: x < 0.25 ? 0 : 0.3 + 0.6 * x,
      brass: 0.2 + 0.6 * x,
      metal: x < 0.4 ? 0 : 0.25 + 0.4 * x,
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
      lobby: { pad: 0.8, arp: 0.45, brass: 0.12 },
      hangar: { pad: 0.65, arp: 0.2, brass: 0.28 },  // pre-deployment: low, patient
      shop: { pad: 0.8, arp: 0.6, brass: 0.2 },
      wave: { pad: 0.5, arp: 0.55, drums: 0.9, bass: 0.85, brass: 0.55, metal: 0.35 },
      boss: { pad: 0.4, arp: 0.5, drums: 1.0, bass: 0.9, brass: 0.8, metal: 0.5, lead: 0.7 },
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
    // bass: driving 8ths following the line, with a clean sine sub octave
    // underneath for cinematic low-end weight
    if (s % 2 === 0) {
      this.tone('bass', SCALE[BASS_LINE[half]] * 0.5, t, STEP * 1.6, 'square', 0.22, 0.02);
      this.tone('bass', SCALE[BASS_LINE[half]] * 0.25, t, STEP * 1.6, 'sine', 0.20, 0.02);
    }
    // BRASS: low swells on the chord root every 2 bars; a rising heroic
    // root-fifth-octave figure leads into each 8-bar boundary
    if (s % 32 === 0) {
      const rootI = [0, 5, 3, 4][Math.floor(s / 32) % 4];
      const f = SCALE[rootI] * 0.5;
      this.tone('brass', f, t, STEP * 26, 'sawtooth', 0.34, 2.2);
      this.tone('brass', f * 1.005, t, STEP * 26, 'sawtooth', 0.30, 2.2);
      this.tone('brass', f * 1.5, t, STEP * 26, 'sawtooth', 0.16, 2.6);
    }
    if (s % 128 === 104) {  // the motif: three rising hits before the turn
      const f = SCALE[0] * 0.5;
      this.tone('brass', f, t, STEP * 6, 'sawtooth', 0.4, 0.08);
      this.tone('brass', f * 1.5, t + STEP * 8, STEP * 6, 'sawtooth', 0.42, 0.08);
      this.tone('brass', f * 2, t + STEP * 16, STEP * 8, 'sawtooth', 0.46, 0.08);
    }
    // METAL: industrial anvil hits off the backbeat
    if (bar16 === 7 || bar16 === 15) this.clank(t);
    // drums
    if (bar16 % 4 === 0) this.kick(t);
    if (bar16 === 4 || bar16 === 12) this.snare(t);
    if (s % 2 === 1) this.hat(t, 0.5);
    if (this.state === 'boss' && s % 2 === 0) this.hat(t, 0.3); // double-time
    // boss: a rolling war-tom fill leading into the downbeat — epic dread
    if (this.state === 'boss' && (bar16 === 13 || bar16 === 14 || bar16 === 15)) {
      this.tom(t, 78 + (bar16 - 13) * 16);
    }
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

  tom(t, freq) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g); g.connect(this.layers.drums);
    o.start(t); o.stop(t + 0.38);
  }

  // struck metal: ringing inharmonic partials through a bandpass — reads as
  // a dockyard anvil, sells the industrial setting
  clank(t) {
    for (const [f, a] of [[817, 0.16], [1233, 0.1], [1968, 0.06]]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 9;
      o.connect(bp); bp.connect(g); g.connect(this.layers.metal);
      o.start(t); o.stop(t + 0.45);
    }
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
