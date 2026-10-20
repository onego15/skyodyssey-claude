// Hand-built scenery: runways, airfield buildings, lighthouse, ruins, natural
// landmarks, trees, crystals and their colliders.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/BufferGeometryUtils.js';
import {
  RUNWAYS, runwayAxes, runwayLocal, RUINS, SEA_ARCH, SUNKEN, CRYSTALS, ISLANDS, CANYON, POIS,
} from './layout.js';
import { Simplex2, mulberry32, clamp, lerp, smoothstep } from './noise.js';
import { canyonInfo } from './terrain.js';
import { buildPlaneModel } from './plane.js';

const noise = new Simplex2(555);
const v3 = new THREE.Vector3();

// Collects coloured geometry and merges it into one mesh.
class Batch {
  constructor() { this.geos = []; }
  add(geo, color, matrix, opt = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (matrix) g.applyMatrix4(matrix);
    const base = new THREE.Color(color);
    const moss = new THREE.Color(opt.moss || '#5d7a3a');
    const pos = g.attributes.position, nor = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(base);
      if (opt.jitter) {
        const n = noise.noise(pos.getX(i) * 0.15 + 3, pos.getZ(i) * 0.15 + pos.getY(i) * 0.1);
        c.multiplyScalar(1 + n * opt.jitter);
      }
      if (opt.moss) {
        const up = nor.getY(i);
        const n = noise.noise(pos.getX(i) * 0.05, pos.getZ(i) * 0.05 + pos.getY(i) * 0.05);
        c.lerp(moss, clamp(smoothstep(0.3, 0.9, up) * 0.6 + n * 0.3, 0, 0.8));
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return g;
  }
  build(material) {
    if (!this.geos.length) return null;
    const merged = mergeGeometries(this.geos, false);
    const m = new THREE.Mesh(merged, material);
    return m;
  }
}

const M4 = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  return m;
};

function roughen(geo, amt, freq, seed = 0) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const n = noise.noise(v3.x * freq + seed, v3.y * freq + v3.z * freq * 0.7);
    const n2 = noise.noise(v3.z * freq * 2.1 - seed, v3.x * freq * 2.1 + v3.y * freq);
    const l = v3.length() || 1;
    v3.multiplyScalar(1 + (n * 0.7 + n2 * 0.3) * amt / l);
    pos.setXYZ(i, v3.x, v3.y, v3.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function runwayTexture(rw) {
  const W = 128, H = 2048;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const pxPerM = H / rw.length;
  const rnd = mulberry32(rw.length);
  if (rw.surface === 'asphalt') {
    g.fillStyle = '#3c3f44'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 4000; k++) {
      const s = 30 + rnd() * 50;
      g.fillStyle = `rgba(${s},${s},${s + 4},0.25)`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 6);
    }
    // tire marks
    g.fillStyle = 'rgba(15,15,15,0.25)';
    for (let k = 0; k < 40; k++) {
      const y = (rnd() < 0.5 ? 0.08 + rnd() * 0.16 : 0.76 + rnd() * 0.16) * H;
      g.fillRect(W / 2 - 18 + rnd() * 36, y, 3, 30 + rnd() * 80);
    }
    g.fillStyle = '#e8e8e2';
    g.fillRect(3, 0, 3, H); g.fillRect(W - 6, 0, 3, H);
    // centreline
    for (let y = 120; y < H - 120; y += 40) g.fillRect(W / 2 - 1.5, y, 3, 22);
    // threshold piano keys
    for (let k = 0; k < 8; k++) {
      const x = 10 + k * 14.5 + (k >= 4 ? 4 : 0);
      g.fillRect(x, 6, 8, 60 * pxPerM * 0.5 + 18); g.fillRect(x, H - 6 - (60 * pxPerM * 0.5 + 18), 8, 60 * pxPerM * 0.5 + 18);
    }
    // aiming points
    const ap = 300 * pxPerM;
    g.fillRect(28, H - ap, 14, 45 * pxPerM); g.fillRect(W - 42, H - ap, 14, 45 * pxPerM);
    g.fillRect(28, ap - 45 * pxPerM, 14, 45 * pxPerM); g.fillRect(W - 42, ap - 45 * pxPerM, 14, 45 * pxPerM);
  } else if (rw.surface === 'grass') {
    g.fillStyle = '#6f8f45'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 6000; k++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(60,90,40,0.35)' : 'rgba(150,170,90,0.3)';
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 2 + rnd() * 5);
    }
    g.fillStyle = 'rgba(140,120,80,0.55)';
    g.fillRect(W / 2 - 22, 0, 16, H); g.fillRect(W / 2 + 6, 0, 16, H);
    g.fillStyle = '#f2f2ea';
    for (let y = 0; y < H; y += 60) { g.fillRect(2, y, 6, 20); g.fillRect(W - 8, y, 6, 20); }
    for (let k = 0; k < 6; k++) { g.fillRect(14 + k * 18, 10, 10, 26); g.fillRect(14 + k * 18, H - 36, 10, 26); }
  } else {
    g.fillStyle = '#8c8b84'; g.fillRect(0, 0, W, H);
    const tile = 10;
    for (let y = 0; y < H; y += tile) {
      const off = (y / tile) % 2 ? tile / 2 : 0;
      for (let x = -off; x < W; x += tile * 1.5) {
        const s = 120 + rnd() * 50;
        g.fillStyle = `rgb(${s},${s - 2},${s - 10})`;
        g.fillRect(x + 1, y + 1, tile * 1.5 - 2, tile - 2);
        if (rnd() < 0.18) { g.fillStyle = 'rgba(80,120,60,0.55)'; g.fillRect(x + 1, y + 1, tile * 1.5 - 2, tile - 2); }
      }
    }
    g.fillStyle = 'rgba(230,220,180,0.8)';
    for (let y = 80; y < H - 80; y += 64) g.fillRect(W / 2 - 3, y, 6, 30);
  }
  // runway numbers (asphalt and stone)
  if (rw.surface !== 'grass') {
    const n1 = Math.round(rw.heading / 10) || 36;
    const n2 = ((n1 + 18 - 1) % 36) + 1;
    const fmt = (n) => String(n).padStart(2, '0');
    g.fillStyle = rw.surface === 'asphalt' ? '#e8e8e2' : 'rgba(240,230,190,0.9)';
    g.font = 'bold 58px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(W / 2, H - 120); g.scale(1, 0.6); g.fillText(fmt(n1), 0, 0); g.restore();
    g.save(); g.translate(W / 2, 120); g.rotate(Math.PI); g.scale(1, 0.6); g.fillText(fmt(n2), 0, 0); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildProps(world) {
  const scene = world.scene;
  const terrain = world.terrain;
  const colliders = world.colliders;
  const group = new THREE.Group();
  scene.add(group);
  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const buildMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  const stone = new Batch(), rocks = new Batch(), build = new Batch();
  const H = (x, z) => terrain.height(x, z);
  const animated = [];
  const lamps = { edge: [], ancient: [] };
  const papis = [];

  // ---------------- Runways ----------------
  const edgeLightGeo = new THREE.SphereGeometry(0.6, 8, 6);
  const edgeLightMat = new THREE.MeshBasicMaterial({ color: '#fff2c0', fog: true });
  const edgePositions = [];
  for (const key in RUNWAYS) {
    const rw = RUNWAYS[key];
    const geo = new THREE.PlaneGeometry(rw.width, rw.length, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-rw.heading * Math.PI / 180);
    const mat = new THREE.MeshStandardMaterial({ map: runwayTexture(rw), roughness: rw.surface === 'asphalt' ? 0.85 : 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(rw.x, rw.elev + 0.05, rw.z);
    m.receiveShadow = true;
    group.add(m);
    // shoulder/apron
    const sh = new THREE.PlaneGeometry(rw.width + 24, rw.length + 60, 1, 1);
    sh.rotateX(-Math.PI / 2); sh.rotateY(-rw.heading * Math.PI / 180);
    const shm = new THREE.Mesh(sh, new THREE.MeshStandardMaterial({ color: rw.surface === 'stone' ? '#7b7a62' : rw.surface === 'grass' ? '#7a8d4c' : '#8a9466', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shm.position.set(rw.x, rw.elev + 0.02, rw.z);
    shm.receiveShadow = true;
    group.add(shm);
    const { dir, right } = runwayAxes(rw);
    // edge lights
    if (rw.surface !== 'stone') {
      for (let a = -rw.length / 2; a <= rw.length / 2; a += 60) {
        for (const s of [-1, 1]) {
          edgePositions.push(new THREE.Vector3(rw.x + dir.x * a + right.x * s * (rw.width / 2 + 2), rw.elev + 0.5, rw.z + dir.z * a + right.z * s * (rw.width / 2 + 2)));
        }
      }
    }
    // PAPI at both ends, left side of each landing direction
    for (const end of [-1, 1]) {
      // landing towards +dir when end = -1 (threshold at -L/2)
      const ld = { x: dir.x * -end, z: dir.z * -end };
      const lr = { x: right.x * -end, z: right.z * -end };
      const tx = rw.x + dir.x * end * (rw.length / 2), tz = rw.z + dir.z * end * (rw.length / 2);
      const ax = tx + ld.x * 180, az = tz + ld.z * 180;
      const unit = [];
      for (let k = 0; k < 4; k++) {
        const off = rw.width / 2 + 10 + k * 5;
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
        box.position.set(ax - lr.x * off, rw.elev + 0.8, az - lr.z * off);
        box.rotation.y = -rw.heading * Math.PI / 180;
        group.add(box);
        unit.push(box);
      }
      papis.push({ rw, x: ax, z: az, y: rw.elev + 0.8, ld, boxes: unit });
    }
  }
  const edgeInst = new THREE.InstancedMesh(edgeLightGeo, edgeLightMat, edgePositions.length);
  edgePositions.forEach((p, i) => { edgeInst.setMatrixAt(i, M4(p.x, p.y, p.z)); });
  group.add(edgeInst);
  lamps.edgeMat = edgeLightMat;

  // ---------------- Home airfield ----------------
  {
    const rw = RUNWAYS.home;
    const { dir, right } = runwayAxes(rw);
    const at = (along, across) => ({ x: rw.x + dir.x * along + right.x * across, z: rw.z + dir.z * along + right.z * across });
    // apron
    const ap = at(-150, 95);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(150, 220).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6c6e70', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    apron.position.set(ap.x, rw.elev + 0.04, ap.z); apron.receiveShadow = true; group.add(apron);
    // hangars
    for (let k = 0; k < 2; k++) {
      const p = at(-210 + k * 70, 150);
      const roof = new THREE.CylinderGeometry(18, 18, 50, 20, 1, false, 0, Math.PI);
      build.add(roof, '#9aa3a8', M4(p.x, rw.elev, p.z, Math.PI / 2, 0, Math.PI / 2));
      build.add(new THREE.BoxGeometry(36, 3, 50), '#6d4b3a', M4(p.x, rw.elev + 1.5, p.z));
      build.add(new THREE.BoxGeometry(30, 14, 0.6), '#c8b48a', M4(p.x - 0.0, rw.elev + 7, p.z + 25.2));
      colliders.push({ type: 'box', x: p.x, z: p.z, hx: 19, hz: 26, y0: rw.elev - 5, y1: rw.elev + 18 });
    }
    // control tower
    {
      const p = at(120, 120);
      build.add(new THREE.CylinderGeometry(3.2, 4, 22, 12), '#e9e3d6', M4(p.x, rw.elev + 11, p.z));
      build.add(new THREE.CylinderGeometry(6.5, 5.5, 5, 12), '#5e8fb0', M4(p.x, rw.elev + 24.5, p.z));
      build.add(new THREE.CylinderGeometry(7.2, 7.2, 1.2, 12), '#b7472f', M4(p.x, rw.elev + 27.6, p.z));
      build.add(new THREE.CylinderGeometry(0.2, 0.2, 6, 4), '#dddddd', M4(p.x, rw.elev + 31, p.z));
      colliders.push({ type: 'cyl', x: p.x, z: p.z, r: 7, y0: rw.elev - 5, y1: rw.elev + 34 });
    }
    // village houses south-east of the field
    const rnd = mulberry32(7);
    const roofCols = ['#b4472f', '#3f6a8a', '#c67b3a', '#8a3f4f', '#4f7a5a'];
    for (let k = 0; k < 46; k++) {
      const x = 380 + rnd() * 700, z = 200 + rnd() * 700;
      const h = H(x, z);
      if (h < 4 || h > 60) continue;
      const l = runwayLocal(rw, x, z);
      if (Math.abs(l.across) < 200) continue;
      const w = 6 + rnd() * 5, d = 8 + rnd() * 6, hh = 4 + rnd() * 3, ry = rnd() * Math.PI;
      build.add(new THREE.BoxGeometry(w, hh, d), '#efe6d2', M4(x, h + hh / 2 - 0.5, z, ry));
      const roof = new THREE.CylinderGeometry(0.01, w * 0.62, d * 1.06, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4);
      const rg = new THREE.ConeGeometry(w * 0.75, 3.2, 4, 1);
      build.add(rg, roofCols[k % roofCols.length], M4(x, h + hh + 1.4, z, ry + Math.PI / 4, 0, 0, 1, 1, d / w));
    }
    // windsock
    const ws = at(380, -45);
    build.add(new THREE.CylinderGeometry(0.15, 0.15, 8, 6), '#dddddd', M4(ws.x, rw.elev + 4, ws.z));
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 10, 1, true).rotateZ(Math.PI / 2).translate(2, 0, 0), new THREE.MeshStandardMaterial({ color: '#ff6a2a', side: THREE.DoubleSide }));
    sock.position.set(ws.x, rw.elev + 7.6, ws.z);
    sock.rotation.y = -(250 - 90 + 180) * Math.PI / 180;
    group.add(sock);
    animated.push((t) => { sock.rotation.z = Math.sin(t * 2.3) * 0.08 - 0.05; });
  }

  // small huts at the other strips
  for (const key of ['lighthouse', 'foothill']) {
    const rw = RUNWAYS[key];
    const { dir, right } = runwayAxes(rw);
    const p = { x: rw.x + dir.x * -120 + right.x * 50, z: rw.z + dir.z * -120 + right.z * 50 };
    const h = rw.elev;
    build.add(new THREE.BoxGeometry(10, 5, 8), '#d8c8a8', M4(p.x, h + 2.5, p.z, -rw.heading * Math.PI / 180));
    build.add(new THREE.ConeGeometry(8, 3, 4), '#7a3a2a', M4(p.x, h + 6.5, p.z, -rw.heading * Math.PI / 180 + Math.PI / 4, 0, 0, 1, 1, 0.85));
    colliders.push({ type: 'cyl', x: p.x, z: p.z, r: 8, y0: h - 3, y1: h + 9 });
    const q = { x: rw.x + dir.x * 200 + right.x * -40, z: rw.z + dir.z * 200 + right.z * -40 };
    build.add(new THREE.CylinderGeometry(0.15, 0.15, 8, 6), '#dddddd', M4(q.x, h + 4, q.z));
    build.add(new THREE.ConeGeometry(0.7, 4, 10, 1, true).rotateZ(Math.PI / 2).translate(2, 0, 0), '#ff6a2a', M4(q.x, h + 7.6, q.z, -(250 - 90 + 180) * Math.PI / 180));
  }

  // ---------------- Lighthouse ----------------
  let beam;
  {
    const x = 2780, z = -3560, h = H(x, z) - 1;
    const segs = 6;
    for (let k = 0; k < segs; k++) {
      const r0 = lerp(4.2, 3.0, k / segs), r1 = lerp(4.2, 3.0, (k + 1) / segs);
      build.add(new THREE.CylinderGeometry(r1, r0, 5, 16), k % 2 ? '#c23a2e' : '#f4f1ea', M4(x, h + 2.5 + k * 5, z));
    }
    const top = h + segs * 5;
    build.add(new THREE.CylinderGeometry(4.2, 4.2, 0.8, 16), '#333a40', M4(x, top + 0.4, z));
    build.add(new THREE.CylinderGeometry(2.3, 2.3, 4, 12), '#ffe9a8', M4(x, top + 2.8, z));
    build.add(new THREE.ConeGeometry(2.9, 3, 12), '#c23a2e', M4(x, top + 6.2, z));
    build.add(new THREE.BoxGeometry(8, 4, 6), '#efe6d2', M4(x + 9, h + 2, z + 3, 0.3));
    build.add(new THREE.ConeGeometry(6, 2.5, 4), '#3f6a8a', M4(x + 9, h + 5.2, z + 3, 0.3 + Math.PI / 4, 0, 0, 1, 1, 0.75));
    colliders.push({ type: 'cyl', x, z, r: 5, y0: h - 5, y1: top + 8 });
    const lantern = new THREE.PointLight('#ffd890', 0, 260, 1.4);
    lantern.position.set(x, top + 3, z);
    group.add(lantern);
    lamps.lighthouse = lantern;
    const beamGeo = new THREE.ConeGeometry(14, 260, 20, 1, true).translate(0, -130, 0).rotateZ(Math.PI / 2);
    beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    beam.position.set(x, top + 3, z);
    group.add(beam);
    animated.push((t) => { beam.rotation.y = t * 0.7; });
  }

  // ---------------- Sea arch ----------------
  {
    const geo = new THREE.TorusGeometry(80, 26, 12, 40, Math.PI);
    roughen(geo, 7, 0.04, 2);
    rocks.add(geo, '#8b7f70', M4(SEA_ARCH.x, -8, SEA_ARCH.z, -SEA_ARCH.heading * Math.PI / 180 + Math.PI / 2), { jitter: 0.25, moss: '#6f8a4a' });
    // arc collider spheres
    const hd = -SEA_ARCH.heading * Math.PI / 180 + Math.PI / 2;
    for (let a = 0; a <= Math.PI + 0.01; a += Math.PI / 14) {
      const lx = Math.cos(a) * 80, ly = Math.sin(a) * 80;
      colliders.push({ type: 'sphere', x: SEA_ARCH.x + lx * Math.cos(hd), y: ly - 8, z: SEA_ARCH.z - lx * Math.sin(hd), r: 27 });
    }
    const rnd = mulberry32(11);
    for (let k = 0; k < 9; k++) {
      const g = roughen(new THREE.IcosahedronGeometry(10 + rnd() * 16, 2), 4, 0.08, k);
      const a = rnd() * Math.PI * 2, r = 110 + rnd() * 110;
      rocks.add(g, '#7d7366', M4(SEA_ARCH.x + Math.sin(a) * r, -4, SEA_ARCH.z + Math.cos(a) * r, rnd() * 3, 0, 0, 1, 0.6 + rnd(), 1), { jitter: 0.25, moss: '#6f8a4a' });
    }
  }

  // ---------------- Sunken colonnade ----------------
  {
    const rnd = mulberry32(21);
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 8; k++) {
        const x = SUNKEN.x - 140 + k * 40, z = SUNKEN.z + (row ? 30 : -30);
        const hh = 10 + rnd() * 26;
        const tilt = (rnd() - 0.5) * 0.25;
        stone.add(new THREE.CylinderGeometry(2.6, 3.0, hh + 12, 12), '#d8cdb4', M4(x, hh / 2 - 6, z, 0, tilt, tilt * 0.5), { jitter: 0.15, moss: '#6a8a5a' });
        if (rnd() < 0.6) stone.add(new THREE.BoxGeometry(7, 2, 7), '#cfc3a8', M4(x, hh, z, rnd(), tilt, 0), { jitter: 0.15 });
        colliders.push({ type: 'cyl', x, z, r: 4, y0: -10, y1: hh + 2 });
      }
    }
    stone.add(new THREE.BoxGeometry(84, 3.5, 7), '#d2c6aa', M4(SUNKEN.x - 20, 30, SUNKEN.z - 30, 0, 0, 0.05), { jitter: 0.15, moss: '#6a8a5a' });
  }

  // ---------------- Ruins: the Temple of Wind ----------------
  const ruins = {};
  {
    const { x, z, elev } = RUINS;
    const sc = '#d6c9a8', sc2 = '#bfb08e';
    stone.add(new THREE.CylinderGeometry(72, 76, 8, 40), sc2, M4(x, elev, z), { jitter: 0.12, moss: '#5f7f45' });
    stone.add(new THREE.CylinderGeometry(52, 54, 5, 40), sc, M4(x, elev + 6, z), { jitter: 0.12, moss: '#5f7f45' });
    colliders.push({ type: 'cyl', x, z, r: 75, y0: elev - 20, y1: elev + 8.5 });
    const rnd = mulberry32(31);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const cx = x + Math.sin(a) * 44, cz = z + Math.cos(a) * 44;
      const broken = rnd() < 0.4;
      const hh = broken ? 6 + rnd() * 10 : 26;
      stone.add(new THREE.CylinderGeometry(2.4, 2.8, hh, 12), sc, M4(cx, elev + 8.5 + hh / 2, cz), { jitter: 0.15, moss: '#5f7f45' });
      stone.add(new THREE.BoxGeometry(6.5, 1.8, 6.5), sc2, M4(cx, elev + 9.4, cz, a), { jitter: 0.1 });
      if (!broken) stone.add(new THREE.BoxGeometry(7, 2, 7), sc2, M4(cx, elev + 8.5 + hh + 1, cz, a), { jitter: 0.1, moss: '#5f7f45' });
      colliders.push({ type: 'cyl', x: cx, z: cz, r: 4, y0: elev, y1: elev + 9 + hh + 2 });
      if (broken) {
        // fallen drum nearby
        const fa = rnd() * Math.PI * 2;
        stone.add(new THREE.CylinderGeometry(2.4, 2.4, 9, 12), sc, M4(cx + Math.sin(fa) * 9, elev + 10, cz + Math.cos(fa) * 9, fa, Math.PI / 2, 0), { jitter: 0.15, moss: '#5f7f45' });
      }
    }
    // partial ring lintels
    for (let k = 0; k < 5; k++) {
      const a = ((k * 3 + 0.5) / 14) * Math.PI * 2;
      stone.add(new THREE.BoxGeometry(20, 2.4, 4), sc2, M4(x + Math.sin(a) * 44, elev + 37, z + Math.cos(a) * 44, a + Math.PI / 2), { jitter: 0.12, moss: '#5f7f45' });
    }
    // altar
    stone.add(new THREE.BoxGeometry(16, 4, 16), sc2, M4(x, elev + 10.5, z, Math.PI / 4), { jitter: 0.1 });
    stone.add(new THREE.BoxGeometry(9, 5, 9), sc, M4(x, elev + 15, z, Math.PI / 4), { jitter: 0.1, moss: '#5f7f45' });
    const crystalMat = new THREE.MeshStandardMaterial({ color: '#9ff3ff', emissive: '#4fd8ff', emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1, flatShading: true });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(4.5, 0), crystalMat);
    crystal.scale.set(1, 1.8, 1);
    crystal.position.set(x, elev + 27, z);
    group.add(crystal);
    const light = new THREE.PointLight('#7fe6ff', 400, 260, 1.5);
    light.position.set(x, elev + 28, z);
    group.add(light);
    // wind ring north of temple
    const ring = new THREE.Mesh(roughen(new THREE.TorusGeometry(24, 3.2, 10, 48), 0.6, 0.3), new THREE.MeshStandardMaterial({ color: '#c9bc9a', roughness: 0.85 }));
    ring.position.set(x, elev + 34, z - 110);
    group.add(ring);
    stone.add(new THREE.BoxGeometry(12, 9, 10), sc2, M4(x, elev + 4, z - 110), { jitter: 0.12, moss: '#5f7f45' });
    colliders.push({ type: 'sphere', x, y: elev + 34, z: z - 110, r: 28 });
    // inner glyph ring disc
    const glyphMat = new THREE.MeshBasicMaterial({ color: '#7fe6ff', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glyph = new THREE.Mesh(new THREE.RingGeometry(19, 21, 48), glyphMat);
    glyph.position.copy(ring.position);
    group.add(glyph);
    // great gate facing the canyon (south)
    const gz = z + 230, gy = H(x, gz);
    for (const s of [-1, 1]) {
      stone.add(new THREE.BoxGeometry(8, 46, 8), sc, M4(x + s * 26, gy + 21, gz), { jitter: 0.12, moss: '#5f7f45' });
      colliders.push({ type: 'box', x: x + s * 26, z: gz, hx: 5, hz: 5, y0: gy - 5, y1: gy + 46 });
    }
    stone.add(new THREE.BoxGeometry(70, 7, 10), sc2, M4(x, gy + 47, gz), { jitter: 0.12, moss: '#5f7f45' });
    colliders.push({ type: 'box', x, z: gz, hx: 36, hz: 6, y0: gy + 43, y1: gy + 51 });
    // stairs
    for (let k = 0; k < 8; k++) stone.add(new THREE.BoxGeometry(30, 1.2, 4), sc2, M4(x, elev + 4 + k * 0.6 - 3, z + 78 - k * 3), { jitter: 0.1 });
    // obelisks
    const obeliskGlow = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const ox = x + Math.sin(a) * 270, oz = z + Math.cos(a) * 270, oy = H(ox, oz);
      stone.add(new THREE.CylinderGeometry(1.6, 3.2, 30, 4), sc, M4(ox, oy + 14, oz, a), { jitter: 0.12, moss: '#5f7f45' });
      const gm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 18, 1.4), glyphMat.clone());
      gm.position.set(ox, oy + 15, oz); gm.rotation.y = a;
      gm.translateX(2.3);
      group.add(gm);
      obeliskGlow.push(gm.material);
      colliders.push({ type: 'cyl', x: ox, z: oz, r: 4, y0: oy - 5, y1: oy + 30 });
    }
    // scattered blocks
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2, r = 90 + rnd() * 260;
      const bx = x + Math.sin(a) * r, bz = z + Math.cos(a) * r, by = H(bx, bz);
      const s = 2 + rnd() * 4;
      stone.add(new THREE.BoxGeometry(s * 1.6, s, s), sc2, M4(bx, by + s * 0.3, bz, rnd() * 3, rnd() * 0.4, rnd() * 0.4), { jitter: 0.15, moss: '#5f7f45' });
    }
    // light pillar (after discovery) and guiding beam toward the phantom island
    const pillarMat = new THREE.MeshBasicMaterial({ color: '#9fefff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(6, 10, 2400, 16, 1, true), pillarMat);
    pillar.position.set(x, elev + 1200, z);
    group.add(pillar);
    const P = ISLANDS.phantom;
    const dx = P.x - x, dz = P.z - z, len = Math.hypot(dx, dz);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(5, 18, len, 12, 1, true), beamMat);
    // from crystal up into the sky toward the island
    const from = new THREE.Vector3(x, elev + 27, z), to = new THREE.Vector3(P.x, 900, P.z);
    guide.position.copy(from).lerp(to, 0.5);
    guide.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    guide.scale.y = from.distanceTo(to) / len;
    group.add(guide);
    Object.assign(ruins, { crystal, crystalMat, light, ring, glyphMat, obeliskGlow, pillarMat, beamMat, active: 0, guide: 0 });
    animated.push((t, dt) => {
      crystal.rotation.y = t * 0.6;
      crystal.position.y = elev + 27 + Math.sin(t * 1.3) * 1.2;
      ring.rotation.z += dt * (0.05 + ruins.active * 0.6);
      glyphMat.opacity = ruins.active * (0.5 + 0.3 * Math.sin(t * 2));
      for (const m of obeliskGlow) m.opacity = ruins.active * 0.9;
      crystalMat.emissiveIntensity = 1.2 + ruins.active * 2.5;
      light.intensity = 300 + ruins.active * 1500;
      pillarMat.opacity = ruins.active * 0.2;
      beamMat.opacity = ruins.guide * (0.16 + 0.04 * Math.sin(t * 1.7));
    });
  }

  // ---------------- Waterfalls ----------------
  {
    const fallTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256;
      const g = c.getContext('2d');
      const rnd = mulberry32(3);
      g.fillStyle = 'rgba(230,245,255,0.55)'; g.fillRect(0, 0, 64, 256);
      for (let k = 0; k < 160; k++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`;
        g.fillRect(rnd() * 64, rnd() * 256, 1 + rnd() * 3, 20 + rnd() * 60);
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const fp = POIS.find((p) => p.id === 'falls');
    const ci = canyonInfo(fp.x, fp.z);
    // find a canyon wall: march east from the canyon centre until the terrain rises 150m
    for (const [k, off] of [[0, -40], [1, 40]]) {
      let wx = fp.x, wz = fp.z + off, top = 0, found = false;
      for (let s = 0; s < 120; s++) {
        wx += 6;
        const h = H(wx, wz);
        if (h > ci.floor + 150) { top = h; found = true; break; }
      }
      if (!found) continue;
      const bottom = ci.floor + 1;
      const height = top - bottom;
      const mat = new THREE.MeshBasicMaterial({ map: fallTex.clone(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
      mat.map.repeat.set(1, height / 60);
      mat.map.needsUpdate = true;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(16, height), mat);
      plane.position.set(wx - 10, bottom + height / 2, wz);
      plane.rotation.y = Math.PI / 2 + 0.15;
      group.add(plane);
      animated.push((t, dt) => { mat.map.offset.y += dt * 1.6; });
      const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.puffTex[k], transparent: true, opacity: 0.7, depthWrite: false, color: '#ffffff' }));
      mist.position.set(wx - 20, bottom + 10, wz); mist.scale.set(70, 40, 1);
      group.add(mist);
    }
  }

  // ---------------- Phantom island ----------------
  const phantom = { lampsOn: 0 };
  {
    const rw = RUNWAYS.secret;
    const { dir, right } = runwayAxes(rw);
    const lampMat = new THREE.MeshBasicMaterial({ color: '#3a3a30', fog: true });
    const lampGeo = new THREE.SphereGeometry(1.1, 10, 8);
    const lampPos = [];
    for (let a = -rw.length / 2; a <= rw.length / 2 + 1; a += 50) {
      for (const s of [-1, 1]) {
        const px = rw.x + dir.x * a + right.x * s * (rw.width / 2 + 5), pz = rw.z + dir.z * a + right.z * s * (rw.width / 2 + 5);
        stone.add(new THREE.CylinderGeometry(0.9, 1.3, 3, 8), '#9a968a', M4(px, rw.elev + 1.5, pz), { jitter: 0.1, moss: '#4a7a5a' });
        lampPos.push(new THREE.Vector3(px, rw.elev + 3.6, pz));
      }
    }
    const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, lampPos.length);
    lampPos.forEach((p, i) => lampInst.setMatrixAt(i, M4(p.x, p.y, p.z)));
    group.add(lampInst);
    phantom.lampMat = lampMat;
    // gates in the caldera rim
    for (const s of [-1, 1]) {
      const d = 1030;
      const gx = rw.x + dir.x * s * d, gz = rw.z + dir.z * s * d;
      const gy = Math.min(H(gx, gz), 140);
      for (const side of [-1, 1]) {
        const px = gx + right.x * side * 95, pz = gz + right.z * side * 95;
        const py = H(px, pz);
        const hgt = gy + 150 - py;
        stone.add(new THREE.BoxGeometry(14, hgt + 30, 14), '#a6a49a', M4(px, py - 15 + (hgt + 30) / 2, pz, -rw.heading * Math.PI / 180), { jitter: 0.12, moss: '#4a7a5a' });
        colliders.push({ type: 'box', x: px, z: pz, hx: 9, hz: 9, y0: py - 30, y1: gy + 150 });
      }
      const lintel = new THREE.BoxGeometry(220, 12, 16);
      stone.add(lintel, '#a6a49a', M4(gx, gy + 156, gz, -rw.heading * Math.PI / 180), { jitter: 0.12, moss: '#4a7a5a' });
      colliders.push({ type: 'obox', x: gx, z: gz, hx: 112, hz: 9, y0: gy + 149, y1: gy + 163, heading: rw.heading });
    }
    // floating rocks
    const rnd = mulberry32(77);
    const floatRocks = [];
    const rockSpots = [[7900, -15950, 400], [7650, -16150, 470], [8150, -15700, 340], [7350, -15900, 520], [8050, -16250, 560], [7700, -15700, 610]];
    for (const [fx, fz, fy] of rockSpots) {
      const r = 22 + rnd() * 26;
      const g = new THREE.Group();
      const body = roughen(new THREE.ConeGeometry(r, r * 2.2, 9, 3).rotateX(Math.PI), r * 0.12, 0.08, fx);
      const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: 0.95, flatShading: true }));
      bodyMesh.position.y = -r * 1.1;
      const cap = roughen(new THREE.CylinderGeometry(r * 1.02, r * 0.95, 4, 9), 1.2, 0.2, fx + 1);
      const capMesh = new THREE.Mesh(cap, new THREE.MeshStandardMaterial({ color: '#5aa07a', roughness: 0.9, flatShading: true }));
      capMesh.position.y = 1;
      bodyMesh.castShadow = true;
      g.add(bodyMesh, capMesh);
      for (let k = 0; k < 4; k++) {
        const tr = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 6), new THREE.MeshStandardMaterial({ color: '#2f6a5c', flatShading: true }));
        tr.position.set((rnd() - 0.5) * r, 7, (rnd() - 0.5) * r);
        g.add(tr);
      }
      g.position.set(fx, fy, fz);
      group.add(g);
      floatRocks.push({ g, base: fy, phase: rnd() * 6, r });
    }
    phantom.floatRocks = floatRocks;
    animated.push((t) => {
      for (const f of floatRocks) {
        f.g.position.y = f.base + Math.sin(t * 0.4 + f.phase) * 6;
        f.g.rotation.y = t * 0.02 + f.phase;
      }
    });
    // grandfather's old plane parked near the end of the secret runway
    const old = buildPlaneModel({ body: '#9a8f78', accent: '#5e6f7a', weathered: true });
    const op = { x: rw.x + dir.x * 330 + right.x * 45, z: rw.z + dir.z * 330 + right.z * 45 };
    old.root.position.set(op.x, rw.elev + 1.55, op.z);
    old.root.rotation.y = -rw.heading * Math.PI / 180 + 2.4;
    old.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(old.root);
    colliders.push({ type: 'cyl', x: op.x, z: op.z, r: 6, y0: rw.elev - 2, y1: rw.elev + 4 });
    // shrine at the runway end
    const sp = { x: rw.x + dir.x * 470, z: rw.z + dir.z * 470 };
    const sy = H(sp.x, sp.z);
    stone.add(new THREE.CylinderGeometry(16, 18, 3, 24), '#a6a49a', M4(sp.x, sy + 1, sp.z), { jitter: 0.1, moss: '#4a7a5a' });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      stone.add(new THREE.CylinderGeometry(1.2, 1.4, 12, 10), '#b6b2a6', M4(sp.x + Math.sin(a) * 12, sy + 8, sp.z + Math.cos(a) * 12), { jitter: 0.1, moss: '#4a7a5a' });
    }
    stone.add(new THREE.ConeGeometry(16, 7, 6), '#8a8678', M4(sp.x, sy + 17.5, sp.z), { jitter: 0.1, moss: '#4a7a5a' });
    colliders.push({ type: 'cyl', x: sp.x, z: sp.z, r: 18, y0: sy - 5, y1: sy + 22 });
  }

  // ---------------- Trees ----------------
  {
    const pine = mergeGeometries([
      new THREE.CylinderGeometry(0.35, 0.5, 3, 5).translate(0, 1.5, 0).toNonIndexed(),
      new THREE.ConeGeometry(3.2, 5.5, 7).translate(0, 4.6, 0).toNonIndexed(),
      new THREE.ConeGeometry(2.5, 4.5, 7).translate(0, 7.2, 0).toNonIndexed(),
      new THREE.ConeGeometry(1.7, 3.5, 7).translate(0, 9.6, 0).toNonIndexed(),
    ]);
    const leaf = mergeGeometries([
      new THREE.CylinderGeometry(0.35, 0.55, 4, 5).translate(0, 2, 0).toNonIndexed(),
      roughen(new THREE.IcosahedronGeometry(3.6, 1), 0.7, 0.4).translate(0, 6, 0).toNonIndexed(),
      roughen(new THREE.IcosahedronGeometry(2.6, 1), 0.5, 0.5, 3).translate(1.6, 7.5, 0.8).toNonIndexed(),
    ]);
    const paintTree = (geo, trunkY) => {
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const trunk = new THREE.Color('#6b4a32'), green = new THREE.Color('#ffffff');
      for (let i = 0; i < pos.count; i++) {
        const c = pos.getY(i) < trunkY && Math.hypot(pos.getX(i), pos.getZ(i)) < 0.7 ? trunk : green;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    };
    paintTree(pine, 3.1); paintTree(leaf, 4.1);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const plans = [
      { grid: 'home', geo: leaf, n: 4800, cols: ['#4f7f32', '#5d8f3a', '#3f6e2c', '#6f9a3e'] },
      { grid: 'lighthouse', geo: leaf, n: 380, cols: ['#4f7f32', '#5d8f3a', '#6f9a3e'] },
      { grid: 'mountain', geo: pine, n: 10000, cols: ['#2f5a32', '#3a6a3a', '#2a4f2e', '#46703c'] },
      { grid: 'phantom', geo: leaf, n: 2600, cols: ['#2f7a62', '#3f8f72', '#5aa07a', '#2a6a5a'] },
    ];
    const rnd = mulberry32(4321);
    const tmpN = new THREE.Vector3();
    const avoidRunway = (x, z) => Object.values(RUNWAYS).some((rw) => {
      const l = runwayLocal(rw, x, z);
      return Math.abs(l.along) < rw.length / 2 + 260 && Math.abs(l.across) < rw.width / 2 + 60;
    });
    for (const p of plans) {
      const g = terrain.grids.find((gg) => gg.id === p.grid);
      const mats = [];
      let tries = 0;
      while (mats.length < p.n && tries < p.n * 12) {
        tries++;
        const x = g.minX + rnd() * g.size, z = g.minZ + rnd() * g.size;
        const h = g.sample(x, z);
        if (h < 6 || h > 980) continue;
        terrain.normal(x, z, tmpN);
        if (tmpN.y < 0.82) continue;
        const dens = noise.fbm(x * 0.0022 + 7, z * 0.0022, 3);
        if (dens < -0.05 + rnd() * 0.25) continue;
        if (avoidRunway(x, z)) continue;
        if (Math.hypot(x - RUINS.x, z - RUINS.z) < 140) continue;
        if (p.grid === 'home' && x > 340 && x < 1120 && z > 160 && z < 940 && rnd() < 0.7) continue;
        const s = 0.75 + rnd() * 0.7;
        const m = M4(x, h - 0.4, z, rnd() * 6.28, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1, s, s * (0.85 + rnd() * 0.4), s);
        mats.push({ m, c: p.cols[Math.floor(rnd() * p.cols.length)] });
      }
      const inst = new THREE.InstancedMesh(p.geo, treeMat, mats.length);
      const cc = new THREE.Color();
      mats.forEach((t, i) => { inst.setMatrixAt(i, t.m); inst.setColorAt(i, cc.set(t.c).multiplyScalar(0.85 + rnd() * 0.3)); });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.receiveShadow = true;
      group.add(inst);
    }
  }

  // ---------------- Crystals ----------------
  const crystals = [];
  {
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(170,240,255,0.6)'); grd.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    world.glowTex = glowTex;
    for (const cd of CRYSTALS) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: '#b8f6ff', emissive: '#5fd0ff', emissiveIntensity: 2.2, flatShading: true, roughness: 0.2 }));
      mesh.scale.y = 1.6;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#a0eaff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glow.scale.set(22, 22, 1);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 160, 8, 1, true).translate(0, 80, 0), new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
      g.add(mesh, glow, shaft);
      g.position.set(cd.x, cd.y, cd.z);
      group.add(g);
      crystals.push({ ...cd, g, mesh, collected: false, glow });
    }
    animated.push((t) => {
      for (const c of crystals) {
        if (c.collected) continue;
        c.mesh.rotation.y = t * 1.5;
        c.mesh.position.y = Math.sin(t * 2 + c.x) * 0.8;
        c.glow.material.opacity = 0.7 + 0.3 * Math.sin(t * 3 + c.z);
      }
    });
  }

  const sm = stone.build(stoneMat); if (sm) { sm.castShadow = true; sm.receiveShadow = true; group.add(sm); }
  const rm = rocks.build(rockMat); if (rm) { rm.castShadow = true; rm.receiveShadow = true; group.add(rm); }
  const bm = build.build(buildMat); if (bm) { bm.castShadow = true; bm.receiveShadow = true; group.add(bm); }

  let t = 0;
  const props = {
    group, ruins, phantom, crystals, papis, lamps,
    setTime(key) {
      const night = key === 'sunset' ? 1 : key === 'dawn' ? 0.6 : 0;
      lamps.edgeMat.color.set(night > 0 ? '#ffe6a0' : '#bdb59a');
      lamps.lighthouse.intensity = night * 2500;
      beam.visible = night > 0;
      beam.material.opacity = 0.08 + night * 0.06;
    },
    update(dt, camera, focus) {
      t += dt;
      for (const f of animated) f(t, dt);
      // PAPI colours from the viewpoint of the aircraft
      for (const p of papis) {
        const dx = focus.x - p.x, dz = focus.z - p.z;
        const dist = Math.hypot(dx, dz);
        // only show the unit facing the approaching aircraft
        const facing = (-(dx * p.ld.x + dz * p.ld.z)) / (dist || 1);
        const ang = Math.atan2(focus.y - p.y, dist) * 180 / Math.PI;
        const th = [2.5, 2.83, 3.17, 3.5];
        p.boxes.forEach((b, i) => {
          const white = ang > th[3 - i];
          b.material.color.set(facing < 0.3 ? '#555555' : white ? '#ffffff' : '#ff2a1a');
        });
      }
      phantom.lampMat.color.set(phantom.lampsOn > 0.5 ? '#ffd27a' : '#3a3a30');
    },
  };
  return props;
}
