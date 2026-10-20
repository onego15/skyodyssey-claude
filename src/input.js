// Keyboard (+ optional gamepad) input with smoothed analog axes.
import { clamp } from './noise.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.invertPitch = false;
    this.override = null; // used by automated test-play scripts
    this.wheel = 0;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }

  sample(dt) {
    if (this.override) return this.override;
    const k = this;
    let tp = 0, tr = 0, ty = 0;
    // flight-sim convention: W/up pushes the nose down, S/down pulls it up
    if (k.down('KeyW', 'ArrowUp')) tp -= 1;
    if (k.down('KeyS', 'ArrowDown')) tp += 1;
    if (this.invertPitch) tp = -tp;
    if (k.down('KeyA', 'ArrowLeft')) tr -= 1;
    if (k.down('KeyD', 'ArrowRight')) tr += 1;
    if (k.down('KeyQ')) ty -= 1;
    if (k.down('KeyE')) ty += 1;
    let thr = 0;
    if (k.down('KeyR', 'ShiftLeft', 'ShiftRight', 'PageUp')) thr += 1;
    if (k.down('KeyF', 'ControlLeft', 'PageDown')) thr -= 1;
    if (this.wheel) { thr -= this.wheel * 4; this.wheel = 0; }
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p);
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      tr += dz(gp.axes[0] || 0);
      tp += dz(gp.axes[1] || 0) * (this.invertPitch ? -1 : 1);
      ty += dz(gp.axes[2] || 0);
      if (gp.buttons[7]) thr += gp.buttons[7].value;
      if (gp.buttons[6]) thr -= gp.buttons[6].value;
    }
    const ramp = (cur, target, up, down) => {
      const rate = Math.abs(target) > Math.abs(cur) ? up : down;
      const d = target - cur;
      return cur + clamp(d, -rate * dt, rate * dt);
    };
    this.axes.pitch = ramp(this.axes.pitch, clamp(tp, -1, 1), 3.2, 5);
    this.axes.roll = ramp(this.axes.roll, clamp(tr, -1, 1), 4, 6);
    this.axes.yaw = ramp(this.axes.yaw, clamp(ty, -1, 1), 3, 5);
    return {
      pitch: this.axes.pitch, roll: this.axes.roll, yaw: this.axes.yaw,
      throttleAxis: clamp(thr, -4, 4), brake: k.down('Space', 'KeyB') || (gp && gp.buttons[0] && gp.buttons[0].pressed),
      throttleSet: null,
    };
  }
}
