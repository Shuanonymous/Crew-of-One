import { ROLE } from '/shared/constants.js';

// Role-aware controls. Every pilot orbits the mech with their own camera;
// what their clicks and keys DO depends on the roles they hold.

export class Input {
  constructor(net) {
    this.net = net;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = -0.2;
    this.mouseL = false;
    this.mouseR = false;
    this.locked = false;
    this.roles = [];
    this.active = false; // only send inputs while in a game
    this.sendTimer = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.locked) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-0.9, Math.min(0.85, this.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouseL = true;
      if (e.button === 2) this.mouseR = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === document.body;
      document.getElementById('click-catch')?.classList.toggle('hidden', this.locked || !this.active);
    });
  }

  begin(roles, facingYaw = 0) {
    this.roles = roles;
    this.active = true;
    this.yaw = facingYaw;
    this.pitch = -0.2;
    if (!this.sendTimer) this.sendTimer = setInterval(() => this.send(), 1000 / 30);
  }

  end() {
    this.active = false;
    this.roles = [];
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null; }
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  requestLock() {
    document.body.requestPointerLock?.();
  }

  has(role) { return this.roles.includes(role); }

  send() {
    if (!this.active || !this.roles.length) return;
    const k = this.keys;
    const data = { aimYaw: this.yaw, aimPitch: this.pitch };

    if (this.has(ROLE.LEGS)) {
      const move = { x: 0, z: 0 };
      if (k.has('KeyW') || k.has('ArrowUp')) move.z -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) move.z += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) move.x -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) move.x += 1;
      data.move = move;
      data.kick = k.has('Space');
      data.dash = k.has('KeyF');
    }
    // Both arms: left click = left fist, right click = right fist.
    // One arm only: either button throws your one punch.
    // J/K always work as backup punch keys (trackpads exist).
    // The HEAD's laser moves to E when the same player also has arms.
    const hasL = this.has(ROLE.ARM_L), hasR = this.has(ROLE.ARM_R);
    if (hasL && hasR) {
      data.punchL = this.mouseL || k.has('KeyJ');
      data.punchR = this.mouseR || k.has('KeyK');
    } else if (hasL) {
      data.punchL = this.mouseL || this.mouseR || k.has('KeyJ') || k.has('KeyK');
    } else if (hasR) {
      data.punchR = this.mouseL || this.mouseR || k.has('KeyJ') || k.has('KeyK');
    }
    if (this.has(ROLE.HEAD)) data.fire = (hasL || hasR) ? k.has('KeyE') : this.mouseL;
    // Ranged: ARMS hold right-click (or C) spins the rotary cannon;
    // HEAD taps R to launch a rocket from the pods.
    if (hasR || hasL) data.spin = this.mouseR || k.has('KeyC');
    if (this.has(ROLE.HEAD)) data.launch = k.has('KeyR');

    this.net.sendInput(data);
  }

  // for the HUD: which keys matter for this role combo
  static keyHints(roles) {
    const has = (r) => roles.includes(r);
    const parts = [];
    if (has(ROLE.LEGS)) parts.push('WASD walk', 'SPACE kick');
    const arms = has(ROLE.ARM_L) && has(ROLE.ARM_R) ? 'L/R CLICK punch'
      : has(ROLE.ARM_L) ? 'CLICK punch' : has(ROLE.ARM_R) ? 'R-CLICK punch' : null;
    if (arms) parts.push(arms);
    if (has(ROLE.HEAD)) {
      parts.push(has(ROLE.ARM_L) || has(ROLE.ARM_R) ? 'HOLD E laser' : 'HOLD CLICK laser');
      parts.push('MOUSE steers the mech\'s face');
    } else if (arms) {
      parts.push('MOUSE aim');
    }
    return parts.join(' · ');
  }
}
