// Procedural terrain: analytic height function, baked per-island height grids,
// and a sampler that matches the rendered triangles exactly (used for collision).
import { Simplex2, clamp, lerp, smoothstep } from './noise.js';
import {
  RUNWAYS, ISLANDS, CANYON, RUINS, PEAK, ISLETS, runwayLocal, WORLD,
} from './layout.js';

const N = new Simplex2(1337);
const N2 = new Simplex2(9001);
const N3 = new Simplex2(271828);

export const SEA_FLOOR = -45;

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return { d: Math.sqrt(dx * dx + dz * dz), t };
}

// Distance to the canyon polyline + interpolated floor height.
export function canyonInfo(x, z) {
  let best = 1e9, floor = 0;
  for (let i = 0; i < CANYON.length - 1; i++) {
    const a = CANYON[i], b = CANYON[i + 1];
    const r = distToSegment(x, z, a.x, a.z, b.x, b.z);
    if (r.d < best) { best = r.d; floor = lerp(a.floor, b.floor, r.t); }
  }
  return { d: best, floor };
}

function flattenRunway(h, rw, x, z) {
  const { along, across } = runwayLocal(rw, x, z);
  const ea = Math.max(0, Math.abs(along) - (rw.length / 2 + rw.pad));
  const ec = Math.max(0, Math.abs(across) - (rw.width / 2 + rw.padSide));
  const e = Math.sqrt(ea * ea + ec * ec);
  if (e > rw.blend) return h;
  const t = smoothstep(0, rw.blend, e);
  return lerp(rw.elev - 0.5, h, t);
}

// Keep approach corridors free of hills so beginners don't fly into terrain.
function corridorMask(rw, x, z, halfLen, halfWidth, fade) {
  const { along, across } = runwayLocal(rw, x, z);
  const ea = Math.max(0, Math.abs(along) - halfLen);
  const ec = Math.max(0, Math.abs(across) - halfWidth);
  return smoothstep(0, fade, Math.sqrt(ea * ea + ec * ec));
}

function hHome(x, z) {
  const I = ISLANDS.home;
  const dx = x - I.x, dz = z - I.z;
  const d = Math.sqrt(dx * dx + dz * dz) / I.r;
  if (d > 1.5) return SEA_FLOOR;
  const coast = d + 0.2 * N.fbm(x * 0.0006, z * 0.0006, 4);
  const land = 1 - smoothstep(0.62, 1.0, coast);
  let h = lerp(SEA_FLOOR, 10, smoothstep(0.0, 0.55, land));
  h += land * land * 6 * N.fbm(x * 0.004, z * 0.004, 3);
  const hills = Math.max(0, N.fbm(x * 0.0011 + 3.1, z * 0.0011 - 7.2, 5) + 0.25);
  const mask = corridorMask(RUNWAYS.home, x, z, 1500, 230, 500);
  h += land * land * hills * 170 * mask;
  return flattenRunway(h, RUNWAYS.home, x, z);
}

function hLighthouse(x, z) {
  const rw = RUNWAYS.lighthouse;
  const { along, across } = runwayLocal(rw, x, z);
  const d = Math.sqrt((along / 1050) ** 2 + (across / 720) ** 2);
  if (d > 1.6) return SEA_FLOOR;
  const coast = d + 0.12 * N.fbm(x * 0.0012, z * 0.0012, 4);
  const land = 1 - smoothstep(0.84, 0.97, coast); // cliffs
  let h = lerp(SEA_FLOOR + 10, 20 + 8 * N.fbm(x * 0.003, z * 0.003, 3), land);
  // Lighthouse headland to the north of the strip.
  const hx = x - 2780, hz = z - (-3560);
  const hill = Math.exp(-(hx * hx + hz * hz) / (230 * 230));
  h += hill * 55 * land;
  return flattenRunway(h, rw, x, z);
}

function hMountain(x, z) {
  const I = ISLANDS.mountain;
  const dx = x - I.x, dz = z - I.z;
  const d = Math.sqrt(dx * dx + dz * dz) / I.r;
  if (d > 1.4) return SEA_FLOOR;
  const coast = d + 0.2 * N.fbm(x * 0.00028, z * 0.00028, 5);
  const land = 1 - smoothstep(0.8, 1.0, coast);
  let h = lerp(SEA_FLOOR, 22 + 10 * N.fbm(x * 0.002, z * 0.002, 3), smoothstep(0, 0.6, land));
  const inland = Math.pow(smoothstep(0.93, 0.3, coast), 1.25);
  const ridge = N.ridged(x * 0.00032 + 11.3, z * 0.00032 + 4.7, 5);
  const bulk = N2.fbm(x * 0.00025, z * 0.00025, 4) * 0.5 + 0.5;
  let m = inland * (180 + 1150 * ridge * (0.45 + bulk));
  // The highest peak.
  const px = x - PEAK.x, pz = z - PEAK.z;
  m += 1000 * Math.exp(-(px * px + pz * pz) / (1250 * 1250)) * inland;
  // Keep the foothill runway corridor low.
  m *= corridorMask(RUNWAYS.foothill, x, z, 1700, 420, 900);
  h += m;
  // Hidden basin around the ruins.
  const rx = x - RUINS.x, rz = z - RUINS.z;
  const rd = Math.sqrt(rx * rx + rz * rz);
  if (rd < RUINS.basinR + 520) {
    const basinFloor = RUINS.elev - 2 + 4 * N3.fbm(x * 0.01, z * 0.01, 2) * smoothstep(120, RUINS.basinR, rd);
    const t = smoothstep(RUINS.basinR * 0.7, RUINS.basinR + 520, rd);
    h = lerp(basinFloor, h, t * t);
  }
  // Canyon carved by the river.
  const c = canyonInfo(x, z);
  const halfW = 190 + 50 * N3.noise(x * 0.002, z * 0.002);
  if (c.d < halfW + 420) {
    const wall = smoothstep(halfW, halfW + 420, c.d);
    const carved = lerp(c.floor - 3, h, wall * wall);
    h = Math.min(h, carved);
  }
  return flattenRunway(h, RUNWAYS.foothill, x, z);
}

function hPhantom(x, z) {
  const I = ISLANDS.phantom;
  const dx = x - I.x, dz = z - I.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const d = dist / I.r;
  if (d > 1.5) return SEA_FLOOR;
  const coast = d + 0.08 * N.fbm(x * 0.0008, z * 0.0008, 4);
  const land = 1 - smoothstep(0.82, 1.0, coast);
  let h = lerp(SEA_FLOOR, 28 + 14 * N.fbm(x * 0.002, z * 0.002, 3), smoothstep(0, 0.5, land));
  // Caldera rim with two gates aligned with the secret runway.
  const ang = Math.atan2(dx, -dz); // bearing from centre
  const hdg = (RUNWAYS.secret.heading * Math.PI) / 180;
  const diff = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  const g1 = diff(ang - hdg), g2 = diff(ang - hdg - Math.PI);
  const gate = 1 - 0.88 * Math.exp(-((Math.min(g1, g2) / 0.2) ** 2));
  const ring = Math.exp(-(((d - 0.5) / 0.13) ** 2));
  const rimH = 360 * (0.8 + 0.45 * N2.fbm(x * 0.0015, z * 0.0015, 4)) + 160 * N.ridged(x * 0.003, z * 0.003, 4);
  const inner = 1 - smoothstep(0.34, 0.46, d);
  h = lerp(h, 84 + 4 * N3.fbm(x * 0.006, z * 0.006, 3), inner);
  h += ring * rimH * gate * land;
  return flattenRunway(h, RUNWAYS.secret, x, z);
}

function hIslet(it, x, z) {
  const dx = x - it.x, dz = z - it.z;
  const d = Math.sqrt(dx * dx + dz * dz) / it.r;
  if (d > 1.6) return SEA_FLOOR;
  const coast = d + 0.25 * N.fbm(x * 0.004, z * 0.004, 3);
  const land = 1 - smoothstep(0.3, 1.0, coast);
  return lerp(SEA_FLOOR, it.h * (0.55 + 0.6 * N2.ridged(x * 0.006, z * 0.006, 4)), land * land);
}

export function heightAt(x, z) {
  let h = SEA_FLOOR + 6 * N.fbm(x * 0.0003, z * 0.0003, 2);
  h = Math.max(h, hHome(x, z));
  h = Math.max(h, hLighthouse(x, z));
  h = Math.max(h, hMountain(x, z));
  h = Math.max(h, hPhantom(x, z));
  for (const it of ISLETS) h = Math.max(h, hIslet(it, x, z));
  return h;
}

// ---- Baked grids ---------------------------------------------------------

export class HeightGrid {
  constructor(minX, minZ, size, res) {
    this.minX = minX; this.minZ = minZ; this.size = size; this.res = res;
    this.cell = size / res;
    this.n = res + 1;
    this.h = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) {
      const z = minZ + j * this.cell;
      for (let i = 0; i < this.n; i++) {
        this.h[j * this.n + i] = heightAt(minX + i * this.cell, z);
      }
    }
  }
  smooth(passes) {
    const n = this.n;
    for (let p = 0; p < passes; p++) {
      const src = this.h.slice();
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        this.h[k] = src[k] * 0.4 + (src[k - 1] + src[k + 1] + src[k - n] + src[k + n]) * 0.15;
      }
    }
  }
  contains(x, z) {
    return x >= this.minX && z >= this.minZ && x <= this.minX + this.size && z <= this.minZ + this.size;
  }
  // Triangle-exact interpolation matching the mesh triangulation (a,c,b) / (b,c,d)
  sample(x, z) {
    const fx = (x - this.minX) / this.cell, fz = (z - this.minZ) / this.cell;
    let i = Math.floor(fx), j = Math.floor(fz);
    i = clamp(i, 0, this.res - 1); j = clamp(j, 0, this.res - 1);
    const u = fx - i, v = fz - j;
    const n = this.n;
    const h00 = this.h[j * n + i], h10 = this.h[j * n + i + 1];
    const h01 = this.h[(j + 1) * n + i], h11 = this.h[(j + 1) * n + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
}

export const GRID_DEFS = [
  { id: 'home', cx: 0, cz: 0, size: 5200, res: 260 },
  { id: 'lighthouse', cx: 2950, cz: -3250, size: 3300, res: 200 },
  { id: 'mountain', cx: -2000, cz: -11800, size: 13600, res: 520, smooth: 1 },
  { id: 'phantom', cx: 7500, cz: -15500, size: 6400, res: 320 },
  ...ISLETS.map((it, k) => ({ id: 'islet' + k, cx: it.x, cz: it.z, size: it.r * 3.4, res: 48 })),
];

export class Terrain {
  constructor() {
    this.grids = GRID_DEFS.map((g) => {
      const grid = new HeightGrid(g.cx - g.size / 2, g.cz - g.size / 2, g.size, g.res);
      grid.id = g.id;
      if (g.smooth) grid.smooth(g.smooth);
      return grid;
    });
  }
  height(x, z) {
    for (const g of this.grids) if (g.contains(x, z)) return g.sample(x, z);
    return SEA_FLOOR;
  }
  normal(x, z, out) {
    const e = 4;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    out.set(-hx, 2 * e, -hz).normalize();
    return out;
  }
}

// Low-resolution world height texture for water shading and the map.
export function bakeWorldHeight(terrain, res = 512) {
  const w = WORLD.maxX - WORLD.minX, d = WORLD.maxZ - WORLD.minZ;
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = WORLD.minX + (i + 0.5) / res * w;
      const z = WORLD.minZ + (j + 0.5) / res * d;
      data[j * res + i] = terrain.height(x, z);
    }
  }
  return { data, res };
}
