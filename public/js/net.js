import { MSG, INTERP_DELAY_MS } from '/shared/constants.js';

// Connects to the server the page came from, buffers world snapshots,
// and answers "where was everything INTERP_DELAY_MS ago?" for smooth
// rendering between 20 Hz updates.

export class Net {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.snapshots = [];
    this.clockOffset = 0;
    this.connected = false;
    // callbacks the app installs
    this.onRoom = () => {};
    this.onGameStart = () => {};
    this.onErr = () => {};
    this.onStatus = () => {};
    this.onSnapshot = () => {};
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.onStatus('connecting…');

    this.ws.onopen = () => { this.connected = true; this.onStatus(''); };
    this.ws.onclose = () => {
      this.connected = false;
      this.onStatus('connection lost — reconnecting…');
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => {};

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.t) {
        case MSG.WELCOME: this.playerId = msg.playerId; break;
        case MSG.ROOM: this.onRoom(msg); break;
        case MSG.GAME_START:
          this.snapshots = [];
          this.onGameStart(msg);
          break;
        case MSG.STATE:
          this.clockOffset = msg.time - performance.now();
          this.snapshots.push(msg);
          if (this.snapshots.length > 40) this.snapshots.shift();
          this.onSnapshot(msg);
          break;
        case MSG.ERR: this.onErr(msg.msg); break;
      }
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
  sendInput(data) { this.send({ t: MSG.INPUT, data }); }

  latest() { return this.snapshots[this.snapshots.length - 1] || null; }

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
    return { a: s[s.length - 2], b: s[s.length - 1], alpha: 1 };
  }
}
