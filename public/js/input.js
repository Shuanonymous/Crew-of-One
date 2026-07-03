// Captures keyboard + mouse and sends the merged input packet to the server
// 30 times a second. Camera yaw/pitch live here because the mouse drives them.

export class Input {
  constructor(net) {
    this.net = net;
    this.keys = new Set();
    this.yaw = 0;          // where the camera (and robot "forward") points
    this.pitch = -0.25;    // up/down look
    this.grab = false;
    this.locked = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0026;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch));
    });
    document.addEventListener('mousedown', () => { if (this.locked) this.grab = true; });
    document.addEventListener('mouseup', () => { this.grab = false; });

    const overlay = document.getElementById('click-catch');
    overlay.addEventListener('click', () => {
      document.body.requestPointerLock?.();
      overlay.classList.add('hidden');
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === document.body;
      if (!this.locked) overlay.classList.remove('hidden');
    });

    setInterval(() => this.send(), 1000 / 30);
  }

  send() {
    const k = this.keys;
    const move = { x: 0, z: 0 };
    if (k.has('KeyW') || k.has('ArrowUp')) move.z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) move.z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) move.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) move.x += 1;

    // Solo mode uses Q/E for lean so it doesn't fight with A/D walking.
    // (When roles are split in Phase 2, the HEAD player will lean with A/D.)
    let lean = 0;
    if (k.has('KeyQ')) lean -= 1;
    if (k.has('KeyE')) lean += 1;

    this.net.sendInput({
      move,
      jump: k.has('Space'),
      lean,
      headYaw: this.yaw,
      aimYaw: this.yaw,
      aimPitch: this.pitch + 0.35, // hands reach a bit higher than the camera looks
      grab: this.grab,
    });
  }
}
