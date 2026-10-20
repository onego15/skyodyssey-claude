// The aircraft: a hand-built low-wing explorer plane and its arcade-leaning flight model.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

// ---------------------------------------------------------------------------
// Model. Local axes: forward = -Z, up = +Y, right = +X. Origin = centre of gravity.
export const GEAR_H = 1.55; // CG height above ground when sitting on the wheels (pitch 0)
export const WHEELS = [
  new THREE.Vector3(-1.45, -GEAR_H, 0.35),
  new THREE.Vector3(1.45, -GEAR_H, 0.35),
  new THREE.Vector3(0, -GEAR_H, -2.35),
];
export const HULL = [
  new THREE.Vector3(-5.5, -0.15, 0.3), new THREE.Vector3(5.5, -0.15, 0.3), // wing tips
  new THREE.Vector3(0, 0.05, -3.7), // spinner
  new THREE.Vector3(0, 1.45, 4.5), // fin top
  new THREE.Vector3(0, -0.75, 0.0), // belly
  new THREE.Vector3(-1.8, 0.15, 4.2), new THREE.Vector3(1.8, 0.15, 4.2), // stabiliser tips
];

function taperedWing(span, rootChord, tipChord, thick, dihedralDeg, sweep = 0) {
  const g = new THREE.BoxGeometry(span, thick, 1, 6, 1, 1);
  const pos = g.attributes.position;
  const dih = Math.tan((dihedralDeg * Math.PI) / 180);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + span / 2; // 0..span
    const t = x / span;
    const chord = lerp(rootChord, tipChord, t);
    let z = pos.getZ(i) * chord + sweep * t;
    let y = pos.getY(i) * lerp(1, 0.6, t) + x * dih;
    // airfoil-ish: thinner trailing edge
    if (pos.getZ(i) > 0) y *= 0.55;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildPlaneModel(opts = {}) {
  const bodyCol = opts.body || '#f1e9d6';
  const accent = opts.accent || '#c8352b';
  const dark = opts.dark || '#26303c';
  const rough = opts.weathered ? 0.85 : 0.42;
  const mBody = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: rough, metalness: 0.15 });
  const mAccent = new THREE.MeshStandardMaterial({ color: accent, roughness: rough, metalness: 0.15 });
  const mDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.3 });
  const mMetal = new THREE.MeshStandardMaterial({ color: '#9aa2aa', roughness: 0.3, metalness: 0.85 });
  const mTire = new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.9 });
  const mGlass = new THREE.MeshStandardMaterial({ color: '#203a55', roughness: 0.05, metalness: 0.6, transparent: true, opacity: opts.weathered ? 0.9 : 0.72 });
  const mats = [mBody, mAccent, mDark, mMetal, mGlass];

  const root = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // fuselage (lathe around Y, then turned so +Y points forward/-Z)
  const prof = [
    [0.0, -4.6], [0.12, -4.5], [0.24, -4.0], [0.4, -2.8], [0.56, -1.4], [0.68, -0.2],
    [0.72, 0.8], [0.7, 1.8], [0.66, 2.6], [0.62, 3.2], [0.5, 3.4], [0.0, 3.42],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.LatheGeometry(prof, 28);
  fus.rotateX(-Math.PI / 2);
  fus.scale(1, 1.12, 1);
  add(fus, mBody, 0, 0.05, 0);
  // cowl ring (accent) and stripes
  const cowl = new THREE.CylinderGeometry(0.665, 0.7, 1.1, 28, 1, true);
  cowl.rotateX(Math.PI / 2);
  add(cowl, mAccent, 0, 0.05, -2.75).scale.set(1, 1.12, 1);
  const stripe = new THREE.CylinderGeometry(0.47, 0.6, 0.35, 28, 1, true).rotateX(Math.PI / 2);
  add(stripe, mAccent, 0, 0.05, 2.1).scale.set(1.01, 1.13, 1);
  const stripe2 = new THREE.CylinderGeometry(0.4, 0.45, 0.2, 28, 1, true).rotateX(Math.PI / 2);
  add(stripe2, mDark, 0, 0.05, 2.55).scale.set(1.01, 1.13, 1);
  // spinner + propeller
  const spinner = add(new THREE.ConeGeometry(0.34, 0.75, 20).rotateX(-Math.PI / 2), mAccent, 0, 0.05, -3.75);
  const prop = new THREE.Group();
  prop.position.set(0, 0.05, -3.55);
  root.add(prop);
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.BoxGeometry(0.16, 1.05, 0.04);
    blade.translate(0, 0.62, 0);
    const b = add(blade, mDark, 0, 0, 0, prop);
    b.rotation.z = (k / 3) * Math.PI * 2;
    b.rotation.y = 0.3;
  }
  const discMat = new THREE.MeshBasicMaterial({ color: '#d8d8d0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const disc = add(new THREE.CircleGeometry(1.7, 32), discMat, 0, 0.05, -3.5);
  disc.castShadow = false;

  // canopy
  const canopy = new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.95, 0.85, 2.2);
  add(canopy, mGlass, 0, 0.62, 0.1);
  const frame = new THREE.TorusGeometry(0.6, 0.04, 6, 24, Math.PI);
  add(frame, mDark, 0, 0.62, -0.5).scale.set(0.95, 0.85, 1);
  // wings
  for (const s of [-1, 1]) {
    const w = taperedWing(5.0, 1.75, 1.05, 0.24, 5, 0.25);
    const wing = add(w, mBody, 0.45 * s, -0.42, 0.25);
    wing.scale.x = s;
    const tip = taperedWing(0.5, 1.07, 0.9, 0.2, 5, 0.05);
    const tm = add(tip, mAccent, 5.42 * s, -0.42 + 4.95 * Math.tan(5 * Math.PI / 180), 0.5);
    tm.scale.x = s;
    // aileron
    const ail = new THREE.Group();
    ail.position.set(3.6 * s, -0.42 + 3.15 * Math.tan(5 * Math.PI / 180), 0.25 + 0.62);
    root.add(ail);
    const ag = new THREE.BoxGeometry(2.1, 0.06, 0.32).translate(0, 0, 0.16);
    add(ag, mAccent, 0, 0, 0, ail);
    ail.rotation.z = 5 * Math.PI / 180 * s;
    if (s < 0) root.userData.ailL = ail; else root.userData.ailR = ail;
    // nav light
    const nl = add(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: s < 0 ? '#ff3030' : '#30ff60' }), 5.68 * s, -0.42 + 5.2 * Math.tan(5 * Math.PI / 180), 0.15);
    nl.castShadow = false;
  }
  // wing root fairing
  add(new THREE.BoxGeometry(1.4, 0.3, 1.8), mBody, 0, -0.45, 0.3);
  // tail
  const stab = taperedWing(1.7, 0.95, 0.6, 0.12, 0, 0.12);
  for (const s of [-1, 1]) {
    const st = add(stab, mBody, 0.15 * s, 0.2, 3.85);
    st.scale.x = s;
  }
  const elev = new THREE.Group();
  elev.position.set(0, 0.2, 4.55);
  root.add(elev);
  add(new THREE.BoxGeometry(3.3, 0.06, 0.34).translate(0, 0, 0.17), mAccent, 0, 0, 0, elev);
  root.userData.elevator = elev;
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(1.25, 0); finShape.lineTo(1.0, 1.35); finShape.lineTo(0.55, 1.4); finShape.lineTo(0, 0);
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false });
  fin.rotateY(Math.PI / 2); fin.translate(-0.05, 0, 0);
  add(fin, mBody, 0, 0.3, 4.6);
  const rud = new THREE.Group();
  rud.position.set(0, 0.3, 4.6);
  root.add(rud);
  add(new THREE.BoxGeometry(0.07, 1.3, 0.38).translate(0, 0.66, 0.15), mAccent, 0, 0, 0, rud);
  root.userData.rudder = rud;
  // landing gear
  const gear = new THREE.Group();
  root.add(gear);
  const wheels = [];
  const mkWheel = (x, y, z, r, pant = true) => {
    const strut = new THREE.CylinderGeometry(0.06, 0.07, Math.abs(y) - 0.15, 8);
    add(strut, mMetal, x * 0.85, (y + -0.45) / 2 + 0.1, z, gear).rotation.z = x * 0.08;
    const wg = new THREE.CylinderGeometry(r, r, 0.18, 18).rotateZ(Math.PI / 2);
    const w = add(wg, mTire, x, y + r, z, gear);
    wheels.push(w);
    if (pant) {
      const p = new THREE.SphereGeometry(0.28, 16, 10);
      p.scale(0.8, 1, 2.2);
      add(p, mAccent, x, y + r + 0.05, z, gear);
    }
  };
  mkWheel(WHEELS[0].x, -GEAR_H, WHEELS[0].z, 0.3);
  mkWheel(WHEELS[1].x, -GEAR_H, WHEELS[1].z, 0.3);
  mkWheel(0, -GEAR_H, WHEELS[2].z, 0.24, false);
  // exhaust
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8).rotateX(Math.PI / 2.4), mMetal, 0.55 * s, -0.3, -2.4);
  // tail light
  add(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 0, 0.25, 4.65).castShadow = false;
  // registration-like stripe on the fuselage side
  const lbl = document.createElement('canvas'); lbl.width = 256; lbl.height = 64;
  const lg = lbl.getContext('2d');
  lg.fillStyle = 'rgba(0,0,0,0)'; lg.fillRect(0, 0, 256, 64);
  lg.font = 'bold 40px sans-serif'; lg.fillStyle = dark; lg.textAlign = 'center'; lg.textBaseline = 'middle';
  lg.fillText(opts.weathered ? 'H-1931' : 'SKY-01', 128, 34);
  const lt = new THREE.CanvasTexture(lbl); lt.colorSpace = THREE.SRGBColorSpace;
  for (const s of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    decal.position.set(0.53 * s, 0.12, 1.1);
    decal.rotation.y = s * Math.PI / 2;
    if (s < 0) decal.scale.x = 1;
    root.add(decal);
  }
  if (opts.weathered) {
    root.traverse((o) => { if (o.isMesh && o.material === mBody) o.material = mBody; });
  }
  return { root, prop, disc, discMat, wheels, mats, gear };
}

// ---------------------------------------------------------------------------
// Flight model
const G = 9.81;
export const PHYS = {
  mass: 1100, S: 16, rho: 1.15,
  CL0: 0.32, CLa: 4.8, aoaStall: 0.27,
  CD0: 0.028, K: 0.045, gearCD: 0.004,
  Tmax: 3700, Tidle: 120, propV: 112,
  pitchRate: 0.65, rollRate: 1.9, yawRate: 0.32,
  kStab: 4.0, kBeta: 2.6,
  rollMu: 0.025, grassMu: 0.075, brakeMu: 0.55,
  maxGroundPitch: 0.2,
  crashVs: -6.0, crashBank: 24, crashPitchDown: -7, crashPitchUp: 19,
};

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();

export class FlightModel {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3(); // pitch, yaw, roll rates (rad/s); positive = up / right / right
    this.throttle = 0;
    this.rpm = 0;
    this.onGround = true;
    this.groundPitch = 0;
    this.heading = 0;
    this.brake = 0;
    this.crashed = false;
    this.events = [];
    this.assist = true;
    this.stall = 0;
    this.gLoad = 1;
    this.aoa = 0;
    this.beta = 0;
    this.airTime = 0;
    this.groundTime = 0;
    this.surface = 'asphalt';
    this.bounce = 0;
    this.lastTouch = null;
    this.suspension = 0;
  }

  placeOnRunway(rw, along = -rw.length / 2 + 40, reverse = false) {
    const h = ((rw.heading + (reverse ? 180 : 0)) * Math.PI) / 180;
    const dir = { x: Math.sin(h), z: -Math.cos(h) };
    this.pos.set(rw.x + dir.x * along, rw.elev + GEAR_H, rw.z + dir.z * along);
    this.heading = h;
    this.groundPitch = 0;
    this.setGroundAttitude();
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.onGround = true;
    this.crashed = false;
    this.crashReason = '';
    this.throttle = 0;
    this.rpm = 0.2;
    this.brake = 0;
    this.airTime = 0;
    this.groundTime = 0;
    this.lastTouch = null;
    this.groundSpeed = 0;
    this.groundRoll = 0;
    this.bounce = 0;
  }

  placeInAir(pos, headingRad, speed) {
    this.pos.copy(pos);
    this.heading = headingRad;
    this.quat.setFromEuler(_e.set(0, -headingRad, 0, 'YXZ'));
    this.vel.set(Math.sin(headingRad) * speed, 0, -Math.cos(headingRad) * speed);
    this.omega.set(0, 0, 0);
    this.onGround = false;
    this.crashed = false;
    this.crashReason = '';
    this.throttle = 0.65;
    this.rpm = 0.65;
    this.airTime = 10;
    this.groundSpeed = null;
    this.bounce = 0;
  }

  setGroundAttitude() {
    this.quat.setFromEuler(_e.set(this.groundPitch, -this.heading, 0, 'YXZ'));
  }

  axes() {
    _f.set(0, 0, -1).applyQuaternion(this.quat);
    _u.set(0, 1, 0).applyQuaternion(this.quat);
    _r.set(1, 0, 0).applyQuaternion(this.quat);
  }

  get speed() { return this.vel.length(); }

  attitude() {
    this.axes();
    const pitch = Math.asin(clamp(_f.y, -1, 1));
    // bank: angle of right vector below horizon, sign right-wing-down positive
    const bank = Math.atan2(-_r.y, _u.y);
    let hdg = Math.atan2(_f.x, -_f.z);
    if (hdg < 0) hdg += Math.PI * 2;
    return { pitch, bank, heading: hdg };
  }

  liftCoef(aoa) {
    const P = PHYS;
    const CLmax = P.CL0 + P.CLa * P.aoaStall;
    if (aoa < -0.25) return P.CL0 + P.CLa * -0.25 + (aoa + 0.25) * 2;
    if (aoa <= P.aoaStall) return P.CL0 + P.CLa * aoa;
    return Math.max(0.55, CLmax - (aoa - P.aoaStall) * 3.2);
  }

  // input: {pitch, roll, yaw in [-1,1], throttleAxis in [-1,1], brake 0/1}
  step(dt, input, env) {
    if (this.crashed) return;
    const P = PHYS;
    this.throttle = clamp(this.throttle + input.throttleAxis * dt * 0.55, 0, 1);
    if (input.throttleSet != null) this.throttle = input.throttleSet;
    this.rpm += (Math.max(this.throttle, 0.08) - this.rpm) * Math.min(1, dt * 2.2);
    this.brake = input.brake ? 1 : 0;

    const speed = this.vel.length();
    this.axes();
    const vf = this.vel.dot(_f), vu = this.vel.dot(_u), vr = this.vel.dot(_r);
    this.aoa = speed > 2 ? Math.atan2(-vu, Math.max(vf, 0.1)) : 0;
    this.beta = speed > 2 ? Math.atan2(vr, Math.max(vf, 0.1)) : 0;
    const qdyn = 0.5 * P.rho * speed * speed;
    const CL = this.liftCoef(this.aoa);
    // propeller thrust falls off with airspeed; a windmilling prop at idle adds drag
    const thrust = lerp(P.Tidle, P.Tmax, this.rpm) * Math.max(0.15, 1 - speed / P.propV)
      - (1 - clamp((this.rpm - 0.08) / 0.4, 0, 1)) * 0.22 * speed * speed;

    if (this.onGround) this.stepGround(dt, input, env, speed, qdyn, CL, thrust);
    else this.stepAir(dt, input, env, speed, qdyn, CL, thrust);
    this.stall = !this.onGround && this.aoa > P.aoaStall - 0.035 && speed > 5 ? 1 : 0;
    this.checkCollisions(env);
  }

  stepAir(dt, input, env, speed, qdyn, CL, thrust) {
    const P = PHYS;
    this.airTime += dt;
    this.groundTime = 0;
    const vdir = _v.copy(this.vel).divideScalar(Math.max(speed, 0.01));
    // forces
    const F = new THREE.Vector3(0, -G * P.mass, 0);
    F.addScaledVector(_f, thrust);
    const liftDir = _p.copy(_u).addScaledVector(vdir, -_u.dot(vdir));
    if (liftDir.lengthSq() > 1e-6) liftDir.normalize();
    const L = CL * qdyn * P.S;
    F.addScaledVector(liftDir, L);
    const CD = P.CD0 + P.gearCD + P.K * CL * CL + (this.aoa > P.aoaStall ? 0.08 : 0);
    F.addScaledVector(vdir, -CD * qdyn * P.S);
    // side force kills sideslip
    F.addScaledVector(_r, -this.vel.dot(_r) * 0.9 * P.mass * Math.min(1, speed / 30));
    this.gLoad = L / (P.mass * G);
    this.vel.addScaledVector(F, dt / P.mass);
    this.pos.addScaledVector(this.vel, dt);

    // attitude
    const eff = clamp(speed / 38, 0.12, 1.15);
    const att = this.attitude();
    const gamma = Math.asin(clamp(vdir.y, -1, 1));
    // FBW trim: angle of attack that holds the flight path (lift = weight component)
    const cphi = Math.cos(att.bank);
    // beginner assist: with the stick released the flight path eases back toward level
    let gdot = 0;
    if (this.assist && Math.abs(input.pitch) < 0.05) gdot = -Math.sign(gamma) * Math.max(0, Math.abs(gamma) - 0.04) * 0.35;
    let CLreq = (P.mass * (G * Math.cos(gamma) + speed * gdot)) / (Math.max(qdyn, 50) * P.S * Math.max(Math.abs(cphi), 0.25)) * Math.sign(cphi || 1);
    CLreq = clamp(CLreq, -0.4, P.CL0 + P.CLa * P.aoaStall * 0.92);
    let aoaTrim = (CLreq - P.CL0) / P.CLa;
    if (!this.assist) aoaTrim = 0.02;
    const cmdPitch = input.pitch * P.pitchRate * eff - (this.aoa - aoaTrim) * P.kStab * Math.min(eff, 1);
    let cmdRoll = input.roll * P.rollRate * eff;
    if (this.assist && Math.abs(att.bank) < 1.5) {
      // bank-angle command: the keys set a bank angle (max 60 deg); releasing them levels the wings
      const targetBank = input.roll * 1.05;
      cmdRoll = clamp((targetBank - att.bank) * 2.6, -P.rollRate * eff, P.rollRate * eff);
    }
    const cmdYaw = input.yaw * P.yawRate * eff + this.beta * P.kBeta * Math.min(eff, 1);
    const k = Math.min(1, dt * 6.5);
    this.omega.x += (cmdPitch - this.omega.x) * k;
    this.omega.y += (cmdYaw - this.omega.y) * k;
    this.omega.z += (cmdRoll - this.omega.z) * Math.min(1, dt * 5);
    _q.setFromAxisAngle(X, this.omega.x * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(Y, -this.omega.y * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(Z, -this.omega.z * dt);
    this.quat.multiply(_q);
    this.quat.normalize();

    // touchdown detection with the wheels
    this.axes();
    let contact = false, minClear = 1e9;
    for (const w of WHEELS) {
      _p.copy(w).applyQuaternion(this.quat).add(this.pos);
      const gh = env.groundHeight(_p.x, _p.z);
      const clear = _p.y - Math.max(gh, env.water ? 0 : -1e9);
      minClear = Math.min(minClear, clear);
      if (clear <= 0) contact = true;
    }
    this.agl = minClear;
    if (contact) this.touchdown(env);
  }

  touchdown(env) {
    const P = PHYS;
    const att = this.attitude();
    const gh = env.groundHeight(this.pos.x, this.pos.z);
    if (gh < 0.2 && env.isWater(this.pos.x, this.pos.z)) {
      return this.crash('着水してしまった…', 'water');
    }
    const vs = this.vel.y;
    const pitchDeg = att.pitch * 180 / Math.PI, bankDeg = Math.abs(att.bank * 180 / Math.PI);
    const n = env.groundNormal(this.pos.x, this.pos.z);
    const surface = env.surfaceAt(this.pos.x, this.pos.z);
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    if (vs < P.crashVs) return this.crash('激しく地面に叩きつけられた…', 'hard');
    if (bankDeg > P.crashBank) return this.crash('翼が地面に接触した…', 'wing');
    if (pitchDeg < P.crashPitchDown) return this.crash('機首から突っ込んでしまった…', 'nose');
    if (pitchDeg > P.crashPitchUp) return this.crash('尾部を強打した…', 'tail');
    if (n.y < 0.965) return this.crash('斜面に接地してしまった…', 'slope');
    if (surface === 'rough' && hspeed > 40) return this.crash('荒れ地で機体が転倒した…', 'rough');
    let grade;
    if (vs > -1.3) grade = { key: 'perfect', label: 'すばらしい着陸！', score: 3 };
    else if (vs > -2.6) grade = { key: 'good', label: 'なめらかな着陸', score: 2 };
    else grade = { key: 'hard', label: 'ハードランディング', score: 1 };
    if (bankDeg > 10 && grade.score > 1) { grade = { key: 'good', label: '少し傾いた着陸', score: 2 }; }
    const info = { vs, pitch: pitchDeg, bank: bankDeg, speed: hspeed, surface, grade, x: this.pos.x, z: this.pos.z };
    this.lastTouch = info;
    // hard landings bounce once
    if (grade.key === 'hard' && this.bounce <= 0) {
      this.vel.y = -vs * 0.32;
      this.pos.y += 0.05;
      this.bounce = 1;
      this.events.push({ type: 'touchdown', info, bounce: true });
      this.suspension = 1;
      return;
    }
    this.bounce = 0;
    this.onGround = true;
    this.surface = surface;
    this.groundPitch = clamp(att.pitch, 0, PHYS.maxGroundPitch);
    // heading from velocity
    this.heading = Math.atan2(this.vel.x, -this.vel.z);
    this.groundRoll = att.bank;
    this.groundSpeed = hspeed;
    this.vel.y = 0;
    this.suspension = clamp(-vs / 3, 0.2, 1);
    this.events.push({ type: 'touchdown', info });
  }

  stepGround(dt, input, env, speed, qdyn, CL, thrust) {
    const P = PHYS;
    this.groundTime += dt;
    if (this.airTime > 0 && this.groundTime > 0.5) this.airTime = 0;
    let gs = this.groundSpeed ?? Math.hypot(this.vel.x, this.vel.z);
    const surface = env.surfaceAt(this.pos.x, this.pos.z);
    this.surface = surface;
    const aoa = this.groundPitch;
    const CLg = this.liftCoef(aoa);
    const qd = 0.5 * P.rho * gs * gs;
    const L = CLg * qd * P.S;
    const W = P.mass * G;
    const normal = Math.max(0, W - L);
    const mu = surface === 'asphalt' || surface === 'stone' ? P.rollMu : P.grassMu * (surface === 'rough' ? 1.6 : 1);
    const CD = P.CD0 + P.gearCD + P.K * CLg * CLg;
    let Fx = thrust * Math.cos(aoa) - CD * qd * P.S - mu * normal - this.brake * P.brakeMu * normal;
    if (gs < 0.05 && Fx < 0) Fx = 0;
    gs = Math.max(0, gs + (Fx / P.mass) * dt);
    if (gs < 0.08 && this.throttle < 0.12) gs = 0;
    this.groundSpeed = gs;
    // steering (rudder or ailerons), weaker with speed
    const steer = clamp(input.yaw + input.roll * 0.5, -1, 1);
    const steerRate = 0.55 * clamp(gs / 6, 0, 1) * (1 - 0.75 * smoothstep(15, 40, gs));
    this.heading += steer * steerRate * dt;
    // elevator on the ground
    const eff = clamp((gs - 12) / 16, 0, 1);
    if (input.pitch > 0.05) this.groundPitch += input.pitch * 0.32 * eff * dt;
    else this.groundPitch -= (0.25 + 0.3 * (1 - eff)) * dt * (1 + input.pitch * -1);
    this.groundPitch = clamp(this.groundPitch, 0, P.maxGroundPitch);
    // settle residual roll from touchdown
    this.groundRoll = (this.groundRoll || 0) * Math.max(0, 1 - dt * 6);
    this.suspension = Math.max(0, this.suspension - dt * 2.5);
    // terrain following
    const gh = env.groundHeight(this.pos.x, this.pos.z);
    const dirx = Math.sin(this.heading), dirz = -Math.cos(this.heading);
    this.vel.set(dirx * gs, 0, dirz * gs);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const gh2 = env.groundHeight(this.pos.x, this.pos.z);
    const wantY = gh2 + GEAR_H + Math.sin(this.groundPitch) * 0.35 - this.suspension * 0.12;
    if (gh2 < 0.2 && env.isWater(this.pos.x, this.pos.z)) return this.crash('海に落ちてしまった…', 'water');
    if (wantY < this.pos.y - 1.2) {
      // ran off a ledge
      this.onGround = false;
      this.quat.setFromEuler(_e.set(this.groundPitch, -this.heading, 0, 'YXZ'));
      return;
    }
    if (env.groundNormal(this.pos.x, this.pos.z).y < 0.93 && gs > 3) return this.crash('斜面で機体が転倒した…', 'slope');
    const bumpy = surface === 'grass' || surface === 'rough' ? Math.sin(this.pos.x * 0.9 + this.pos.z * 1.3) * 0.03 * Math.min(1, gs / 20) : 0;
    this.pos.y = wantY + bumpy;
    this.quat.setFromEuler(_e.set(this.groundPitch, -this.heading, -this.groundRoll, 'YXZ'));
    this.omega.set(0, 0, 0);
    this.aoa = aoa;
    this.gLoad = 1;
    this.agl = 0;
    // lift-off
    if (L > W * 1.02) {
      this.onGround = false;
      this.groundSpeed = null;
      this.vel.y = 0.6;
      this.airTime = 0;
      this.events.push({ type: 'liftoff', speed: gs });
    }
  }

  checkCollisions(env) {
    if (this.crashed) return;
    for (const p of HULL) {
      _p.copy(p).applyQuaternion(this.quat).add(this.pos);
      const gh = env.groundHeight(_p.x, _p.z);
      if (_p.y < gh - (this.onGround ? 0.3 : 0.0)) return this.crash('地形に衝突してしまった…', 'terrain');
      if (_p.y < 0 && gh < 0) return this.crash('海に墜落してしまった…', 'water');
      if (env.hitsCollider(_p)) return this.crash('障害物に衝突してしまった…', 'object');
    }
    for (const w of WHEELS) {
      _p.copy(w).applyQuaternion(this.quat).add(this.pos);
      if (env.hitsCollider(_p)) return this.crash('障害物に衝突してしまった…', 'object');
    }
  }

  crash(reason, kind) {
    this.crashed = true;
    this.crashReason = reason;
    this.events.push({ type: 'crash', reason, kind });
  }
}
