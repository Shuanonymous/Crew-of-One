import { MSG, INTERP_DELAY_MS } from '/shared/constants.js';

// Connects to the server on the same address the page came from,
// keeps a short buffer of world snapshots, and lets the renderer ask
// "where was everything INTERP_DELAY_MS ago?" for smooth motion.

export class Net {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.role = null;
    this.world = null;          // static world info from the welcome message
    this.snapshots = [];        // recent state snapshots, oldest first
    this.clockOffset = 0;       // serverTime - clientTime estimate
    this.onWelcome = () => {};
    this.onEvent = () => {};
    this.onStatus = () => {};
    this.connected = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.onStatus('connecting…');

    this.ws.onopen = () => {
      this.connected = true;
      this.onStatus('connected');
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.onStatus('disconnected — retrying…');
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => {};

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.t === MSG.WELCOME) {
        this.playerId = msg.playerId;
        this.role = msg.role;
        this.world = msg.world;
        this.onWelcome(msg);
      } else if (msg.t === MSG.STATE) {
        this.clockOffset = msg.time - performance.now();
        this.snapshots.push(msg);
        if (this.snapshots.length > 40) this.snapshots.shift();
        for (const r of msg.robots) {
          for (const ev of r.ev || []) this.onEvent(ev, r);
        }
      }
    };
  }

  sendInput(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: MSG.INPUT, data }));
    }
  }

  // Returns { a, b, alpha }: the two snapshots around the render time and
  // how far between them (0..1) we are. Null until enough data arrives.
  sample() {
    if (this.snapshots.length < 2) return null;
    const renderTime = performance.now() + this.clockOffset - INTERP_DELAY_MS;
    const s = this.snapshots;
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].time <= renderTime && renderTime <= s[i].time) {
        const span = s[i].time - s[i - 1].time || 1;
        return { a: s[i - 1], b: s[i], alpha: (renderTime - s[i - 1].time) / span };
      }
    }
    // We're ahead of (or behind) the buffer — show the freshest state.
    return { a: s[s.length - 2], b: s[s.length - 1], alpha: 1 };
  }
}
