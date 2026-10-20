// Third-person camera rig: smoothed chase cam, cockpit, flyby, and scripted
// cinematic shots (lift-off, discovery, landing) blended on top.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export const CAM_MODES = ['chase', 'far', 'cockpit', 'flyby'];
export const CAM_LABELS = { chase: '追従カメラ', far: '遠景カメラ', cockpit: 'コックピット', flyby: 'フライバイ' };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.q = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.shakeT = 0;
    this.cine = null;
    this.blend = 0;
    this.orbitYaw = 0; this.orbitPitch = 0;
    this.drag = null;
    this.flyby = new THREE.Vector3();
    this.flybyTimer = 0;
    this.initialized = false;
    this.fov = 62;
    const el = document.body;
    el.addEventListener('mousedown', (e) => { if (e.target.tagName === 'CANVAS') this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.orbitYaw -= (e.clientX - this.drag.x) * 0.006;
      this.orbitPitch = clamp(this.orbitPitch + (e.clientY - this.drag.y) * 0.004, -0.6, 1.0);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { this.drag = null; });
  }

  cycle() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.flybyTimer = 0;
    return this.mode;
  }

  addShake(a) { this.shake = Math.max(this.shake, a); }

  // type: 'liftoff' | 'discovery' | 'landed' | 'crash'
  play(type, opts = {}) {
    this.cine = { type, t: 0, dur: opts.dur || 4, ...opts, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    if (opts.anchor) this.cine.anchor = opts.anchor.clone();
  }

  reset(fm) {
    this.initialized = false;
    this.cine = null;
    this.blend = 0;
    this.update(0, fm, 0, null);
  }

  update(dt, fm, gameTime, world) {
    const cam = this.camera;
    fm.axes();
    _f.set(0, 0, -1).applyQuaternion(fm.quat);
    _u.set(0, 1, 0).applyQuaternion(fm.quat);
    const speed = fm.speed;
    // ---- base camera
    const basePos = _a, baseLook = _b;
    if (this.mode === 'cockpit') {
      basePos.set(0, 0.95, 0.35).applyQuaternion(fm.quat).add(fm.pos);
      baseLook.copy(_f).multiplyScalar(50).add(basePos);
    } else if (this.mode === 'flyby') {
      this.flybyTimer -= dt;
      const d = this.flyby.distanceTo(fm.pos);
      if (this.flybyTimer <= 0 || d > 260) {
        const side = Math.random() < 0.5 ? -1 : 1;
        _r.set(1, 0, 0).applyQuaternion(fm.quat);
        this.flyby.copy(fm.pos).addScaledVector(fm.vel, 3.2).addScaledVector(_r, side * (18 + Math.random() * 20));
        this.flyby.y += (Math.random() - 0.3) * 10;
        if (world) this.flyby.y = Math.max(this.flyby.y, world.groundHeight(this.flyby.x, this.flyby.z) + 3);
        this.flybyTimer = 6.5;
      }
      basePos.copy(this.flyby);
      baseLook.copy(fm.pos);
    } else {
      const far = this.mode === 'far';
      // target orientation: plane's heading/pitch with only part of the roll
      const flatUp = _r.copy(UP).lerp(_u, fm.onGround ? 0 : 0.28).normalize();
      _m.lookAt(new THREE.Vector3(), _f, flatUp);
      const tq = new THREE.Quaternion().setFromRotationMatrix(_m);
      if (!this.initialized) { this.q.copy(tq); }
      const rate = fm.onGround ? 5 : 3.2;
      this.q.slerp(tq, 1 - Math.exp(-dt * rate));
      const dist = (far ? 34 : 15.5) + clamp(speed - 30, 0, 50) * (far ? 0.12 : 0.06);
      const height = (far ? 9 : 3.6) + (fm.onGround ? -0.4 : 0);
      const off = new THREE.Vector3(0, height, dist);
      // mouse orbit
      if (!this.drag) { this.orbitYaw *= Math.exp(-dt * 1.5); this.orbitPitch *= Math.exp(-dt * 1.5); }
      off.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.orbitPitch).applyAxisAngle(UP, this.orbitYaw);
      basePos.copy(off).applyQuaternion(this.q).add(fm.pos);
      const lookAhead = new THREE.Vector3(0, 1.2, -12).applyQuaternion(this.q);
      baseLook.copy(fm.pos).add(lookAhead);
    }
    // ---- cinematic overlay
    let w = 0;
    const c = this.cine;
    if (c) {
      c.t += dt;
      if (c.type === 'liftoff') {
        if (!c.init) {
          _r.set(1, 0, 0).applyQuaternion(fm.quat); _r.y = 0; _r.normalize();
          const fwd = _f.clone(); fwd.y = 0; fwd.normalize();
          c.pos.copy(fm.pos).addScaledVector(fwd, 70).addScaledVector(_r, 22);
          c.pos.y = (world ? world.groundHeight(c.pos.x, c.pos.z) : fm.pos.y - 2) + 2.2;
          c.init = true;
        }
        c.look.copy(fm.pos);
      } else if (c.type === 'discovery') {
        // frame the aircraft in the foreground and the discovery behind it
        const target = c.target;
        const toT = target.clone().sub(fm.pos); const dist = toT.length(); toT.normalize();
        const side = new THREE.Vector3().crossVectors(toT, UP).normalize();
        const k = smoothstep(0, c.dur, c.t);
        c.pos.copy(fm.pos).addScaledVector(toT, -24 - k * 10).addScaledVector(side, 14 + k * 8);
        c.pos.y += 7 + k * 5;
        c.look.copy(fm.pos).lerp(target, clamp(160 / Math.max(dist, 1), 0.25, 0.7));
      } else if (c.type === 'landed') {
        const a = c.t * 0.28 + (c.a0 || 0);
        c.pos.set(Math.sin(a) * 18, 4.5, Math.cos(a) * 18).add(fm.pos);
        c.look.copy(fm.pos).add(new THREE.Vector3(0, 0.6, 0));
      } else if (c.type === 'crash') {
        if (!c.init) { c.pos.copy(cam.position); c.init = true; }
        c.look.lerp(fm.pos, 0.2);
        if (c.t < 0.05) c.look.copy(fm.pos);
      } else if (c.type === 'ending') {
        const a = c.t * 0.12;
        c.pos.set(Math.sin(a) * 60, 22 + Math.sin(c.t * 0.2) * 6, Math.cos(a) * 60).add(fm.pos);
        c.look.copy(fm.pos);
      }
      const fadeIn = c.instant ? 1 : smoothstep(0, 0.9, c.t);
      const fadeOut = c.hold ? 1 : 1 - smoothstep(c.dur - 1.0, c.dur, c.t);
      w = Math.min(fadeIn, fadeOut);
      if (!c.hold && c.t >= c.dur) { this.cine = null; w = 0; }
    }
    this.blend = w;
    const finalPos = this.pos.copy(basePos);
    const finalLook = this.look.copy(baseLook);
    if (c && w > 0) {
      finalPos.lerp(c.pos, w);
      finalLook.lerp(c.look, w);
    }
    // keep camera above ground
    if (world) {
      const gh = Math.max(world.groundHeight(finalPos.x, finalPos.z), 0);
      if (finalPos.y < gh + 1.6) finalPos.y = gh + 1.6;
    }
    cam.position.copy(finalPos);
    const upv = this.mode === 'cockpit' && w < 0.5 ? _u : UP;
    cam.up.copy(upv);
    cam.lookAt(finalLook);
    if (this.mode !== 'cockpit' && w < 0.01 && !fm.onGround) {
      // a touch of roll into turns
      const rollAmt = clamp(fm.omega.z, -2, 2) * -0.02;
      cam.rotateZ(rollAmt);
    }
    // shake
    let sh = this.shake;
    if (fm.onGround && speed > 1) sh = Math.max(sh, (fm.surface === 'asphalt' ? 0.012 : 0.04) * clamp(speed / 30, 0, 1.2));
    if (fm.stall) sh = Math.max(sh, 0.05);
    if (sh > 0.001) {
      this.shakeT += dt * 40;
      cam.rotateX(Math.sin(this.shakeT * 1.3) * sh * 0.08);
      cam.rotateY(Math.sin(this.shakeT * 0.9 + 1) * sh * 0.06);
      cam.position.y += Math.sin(this.shakeT * 1.7) * sh * 0.6;
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
    // FOV with speed
    const targetFov = (this.mode === 'cockpit' ? 70 : 60) + clamp((speed - 35) / 35, 0, 1) * 12 - w * 6;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 2);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.initialized = true;
  }
}
