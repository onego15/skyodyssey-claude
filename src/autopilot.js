// Test autopilot. Produces exactly the same input object as the keyboard so the
// automated play-tests exercise the real flight model. Not exposed in normal play;
// it is reachable only through the window.__sky test API.
import { clamp } from './noise.js';
import { RUNWAYS, runwayAxes, runwayLocal } from './layout.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  constructor(game) {
    this.g = game;
    this.mode = 'idle';
    this.target = null;
    this.log = [];
  }

  takeoff(then) { this.mode = 'takeoff'; this.then = then; }
  fly(opts) { this.mode = 'fly'; this.target = { alt: 300, speed: 50, ...opts }; }
  land(rwId, reverse = false) {
    this.mode = 'land';
    const rw = RUNWAYS[rwId];
    const { dir } = runwayAxes(rw);
    const s = reverse ? -1 : 1;
    this.rw = rw; this.dirS = s;
    this.ldir = { x: dir.x * s, z: dir.z * s };
    this.phase = 'intercept';
  }
  stop() { this.mode = 'idle'; }

  steer(input, fm, hdgTarget, altTarget, speedTarget, maxBank = 0.6) {
    const att = fm.attitude();
    const herr = wrap(hdgTarget - att.heading);
    const bankT = clamp(herr * 1.8, -maxBank, maxBank);
    // with the beginner assist the roll input is a bank-angle command
    input.roll = fm.assist ? clamp(bankT / 1.05, -1, 1) : clamp((bankT - att.bank) * 2.2 - fm.omega.z * 0.3, -1, 1);
    const vsT = clamp((altTarget - fm.pos.y) * 0.12, -9, 8);
    input.pitch = clamp((vsT - fm.vel.y) * 0.22, -1, 1);
    const sp = fm.speed;
    input.throttleSet = clamp(0.55 + (speedTarget - sp) * 0.08 + (vsT > 2 ? 0.25 : 0), 0, 1);
    return herr;
  }

  update(dt) {
    const fm = this.g.fm;
    const input = { pitch: 0, roll: 0, yaw: 0, throttleAxis: 0, brake: false, throttleSet: null };
    if (this.mode === 'idle') return input;
    if (this.mode === 'takeoff') {
      input.throttleSet = 1;
      const att = fm.attitude();
      if (fm.onGround) {
        input.pitch = fm.speed > 29 ? 0.8 : 0;
        // keep on the centreline
        const rw = this.g.nearestRunway();
        if (rw) {
          const hd = this.g.runHeading ?? att.heading;
          const across = (fm.pos.x - rw.x) * Math.cos(hd) + (fm.pos.z - rw.z) * Math.sin(hd);
          input.yaw = clamp(wrap(hd - att.heading) * 3 - across * 0.02, -1, 1);
        }
      } else {
        input.pitch = clamp((5 - fm.vel.y) * 0.2, -1, 1);
        if (fm.pos.y - this.g.groundAt(fm.pos.x, fm.pos.z) > 60) { this.mode = 'idle'; if (this.then) this.then(); }
      }
      return input;
    }
    if (this.mode === 'fly') {
      const t = this.target;
      let hdg = t.heading;
      if (t.x != null) hdg = Math.atan2(t.x - fm.pos.x, -(t.z - fm.pos.z));
      const minAlt = this.g.groundAt(fm.pos.x, fm.pos.z) + 120;
      // look ahead for terrain
      let ahead = 0;
      for (const d of [300, 700, 1200]) {
        const x = fm.pos.x + Math.sin(hdg) * d, z = fm.pos.z - Math.cos(hdg) * d;
        ahead = Math.max(ahead, this.g.groundAt(x, z) + 140);
      }
      this.steer(input, fm, hdg, Math.max(t.alt, minAlt, ahead), t.speed, t.maxBank || 0.6);
      return input;
    }
    if (this.mode === 'land') {
      const rw = this.rw;
      const thr = { x: rw.x - this.ldir.x * rw.length / 2, z: rw.z - this.ldir.z * rw.length / 2 };
      const dx = fm.pos.x - thr.x, dz = fm.pos.z - thr.z;
      const along = dx * this.ldir.x + dz * this.ldir.z; // negative before threshold
      const cross = dx * -this.ldir.z + dz * this.ldir.x; // + = right of centreline
      const rhdg = Math.atan2(this.ldir.x, -this.ldir.z);
      const att = fm.attitude();
      if (fm.onGround) {
        input.throttleSet = 0;
        input.brake = true;
        input.yaw = clamp(wrap(rhdg - att.heading) * 3 - cross * 0.03, -1, 1);
        input.pitch = 0;
        return input;
      }
      if (this.phase === 'intercept') {
        // fly to a point 4.5 km out on the extended centreline
        const fx = thr.x - this.ldir.x * 4500, fz = thr.z - this.ldir.z * 4500;
        const d = Math.hypot(fm.pos.x - fx, fm.pos.z - fz);
        const hdg = Math.atan2(fx - fm.pos.x, -(fz - fm.pos.z));
        this.steer(input, fm, hdg, rw.elev + 4500 * Math.tan(3.3 * Math.PI / 180) + 30, 48);
        if (d < 600 || (along < -2500 && along > -5200 && Math.abs(cross) < 250)) this.phase = 'final';
        return input;
      }
      // final approach: track centreline and glideslope to a point 150 m past threshold
      const corr = clamp(-cross * 0.004, -0.5, 0.5);
      const hdg = rhdg + corr;
      const distToAim = -(along - 160);
      const gsAlt = rw.elev + Math.max(0, distToAim) * Math.tan(3.2 * Math.PI / 180) + 1.6;
      const agl = fm.pos.y - this.g.groundAt(fm.pos.x, fm.pos.z) - 1.55;
      if (agl < 7 && along > -150) {
        // flare
        const herr = wrap(hdg - att.heading);
        const bt = clamp(herr * 1.5, -0.15, 0.15);
        input.roll = fm.assist ? bt / 1.05 : clamp((bt - att.bank) * 2.5, -1, 1);
        input.yaw = clamp(herr * 2, -1, 1);
        input.throttleSet = 0;
        const vsT = -1.3 - agl * 0.1;
        input.pitch = clamp((vsT - fm.vel.y) * 0.35, -0.2, 1);
        return input;
      }
      this.steer(input, fm, hdg, gsAlt, 37, 0.35);
      input.throttleSet = clamp(input.throttleSet, 0.05, 0.75);
      return input;
    }
    return input;
  }
}
