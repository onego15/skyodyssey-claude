// Visual effects: smoke/dust/splash puffs, wingtip vapour trails, air streaks.
import * as THREE from 'three';
import { clamp } from './noise.js';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Trail {
  constructor(scene, n = 90) {
    this.n = n;
    this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(1.0,1.0,1.0, vA * 0.55); }',
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  push(p, up, strength) {
    this.pts.unshift({ p: p.clone(), up: up.clone(), s: strength });
    if (this.pts.length > this.n) this.pts.pop();
  }
  update(dt) {
    for (const q of this.pts) q.s *= Math.exp(-dt * 1.4);
    for (let i = 0; i < this.n; i++) {
      const q = this.pts[i] || this.pts[this.pts.length - 1];
      if (!q) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
      const w = 0.18 + i * 0.012;
      this.pos.set([q.p.x + q.up.x * w, q.p.y + q.up.y * w, q.p.z + q.up.z * w], i * 6);
      this.pos.set([q.p.x - q.up.x * w, q.p.y - q.up.y * w, q.p.z - q.up.z * w], i * 6 + 3);
      const a = this.pts[i] ? q.s * (1 - i / this.n) : 0;
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
  clear() { this.pts.length = 0; }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tex = softTexture();
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 160; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: true }));
      s.visible = false;
      scene.add(s);
      this.pool.push(s);
    }
    this.trails = [new Trail(scene), new Trail(scene)];
    // air streaks around the camera
    const n = 260;
    const g = new THREE.BufferGeometry();
    this.streakPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.streakPos.set([(Math.random() - 0.5) * 80, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 80], i * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3));
    this.streakMat = new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.streaks = new THREE.Points(g, this.streakMat);
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
    this.dustTimer = 0;
  }

  puff(pos, opts = {}) {
    const s = this.pool.pop() || this.active.shift()?.s;
    if (!s) return;
    s.visible = true;
    s.position.copy(pos);
    const size = opts.size || 3;
    s.scale.set(size, size, 1);
    s.material.color.set(opts.color || '#ffffff');
    s.material.opacity = opts.opacity ?? 0.6;
    s.material.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.active.push({
      s, life: 0, maxLife: opts.life || 2, grow: opts.grow || 3, vel: (opts.vel || new THREE.Vector3()).clone(),
      opacity: s.material.opacity, rise: opts.rise ?? 0.5,
    });
  }

  burst(pos, n, opts) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5)).multiplyScalar(opts.speed || 6);
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2));
      this.puff(p, { ...opts, vel: v, life: (opts.life || 2) * (0.7 + Math.random() * 0.6), size: (opts.size || 3) * (0.6 + Math.random() * 0.8) });
    }
  }

  tyreSmoke(points) {
    for (const p of points) this.burst(p, 5, { color: '#e8e4dc', size: 2.2, grow: 4, life: 2.2, speed: 2.5, opacity: 0.55 });
  }

  crash(pos, water) {
    if (water) {
      this.burst(pos, 30, { color: '#f0f8ff', size: 6, grow: 6, life: 2.5, speed: 14, opacity: 0.8, rise: 2 });
    } else {
      this.burst(pos, 14, { color: '#ffb060', size: 7, grow: 5, life: 0.8, speed: 10, opacity: 0.9, additive: true });
      this.burst(pos, 30, { color: '#3a3532', size: 8, grow: 8, life: 5, speed: 6, opacity: 0.7, rise: 3 });
    }
  }

  sparkle(pos) {
    this.burst(pos, 24, { color: '#a8f0ff', size: 2.5, grow: 2, life: 1.4, speed: 16, opacity: 1, additive: true, rise: 0 });
  }

  update(dt, fm, camera, worldInfo) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.life += dt;
      const k = a.life / a.maxLife;
      if (k >= 1) { a.s.visible = false; this.pool.push(a.s); this.active.splice(i, 1); continue; }
      a.vel.multiplyScalar(Math.exp(-dt * 1.5));
      a.vel.y += a.rise * dt;
      a.s.position.addScaledVector(a.vel, dt);
      const sc = a.s.scale.x + a.grow * dt;
      a.s.scale.set(sc, sc, 1);
      a.s.material.opacity = a.opacity * (1 - k) * (1 - k);
    }
    // wingtip vapour under load or in humid air
    const tipL = new THREE.Vector3(-5.6, -0.1, 0.4).applyQuaternion(fm.quat).add(fm.pos);
    const tipR = new THREE.Vector3(5.6, -0.1, 0.4).applyQuaternion(fm.quat).add(fm.pos);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(fm.quat);
    const load = clamp((fm.gLoad - 1.35) / 1.0, 0, 1) * clamp((fm.speed - 30) / 20, 0, 1);
    const humid = (worldInfo && worldInfo.inCloud > 0.1) ? 0.6 : 0;
    const strength = fm.crashed || fm.onGround ? 0 : Math.max(load, humid * clamp(fm.speed / 50, 0, 1));
    this.trails[0].push(tipL, up, strength);
    this.trails[1].push(tipR, up, strength);
    for (const t of this.trails) t.update(dt);
    // dust while rolling on grass
    if (fm.onGround && !fm.crashed && fm.speed > 8 && fm.surface !== 'asphalt') {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.06;
        const p = new THREE.Vector3((Math.random() - 0.5) * 3, -1.4, 1.5).applyQuaternion(fm.quat).add(fm.pos);
        this.puff(p, { color: fm.surface === 'stone' ? '#cfcac0' : '#c8b88e', size: 1.5, grow: 3, life: 1.6, opacity: 0.35 });
      }
    }
    // streaks
    const sp = fm.speed;
    this.streakMat.opacity = clamp((sp - 35) / 40, 0, 0.55) * (fm.onGround ? 0 : 1);
    const cp = camera.position;
    const arr = this.streakPos;
    const vx = fm.vel.x * dt, vy = fm.vel.y * dt, vz = fm.vel.z * dt;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] -= vx * 0.0; arr[i + 1] -= vy * 0.0; arr[i + 2] -= vz * 0.0;
      // keep within box around camera (world-anchored particles)
      let x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (x - cp.x > 40) x -= 80; else if (x - cp.x < -40) x += 80;
      if (y - cp.y > 25) y -= 50; else if (y - cp.y < -25) y += 50;
      if (z - cp.z > 40) z -= 80; else if (z - cp.z < -40) z += 80;
      arr[i] = x; arr[i + 1] = y; arr[i + 2] = z;
    }
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }

  reset() {
    for (const a of this.active) { a.s.visible = false; this.pool.push(a.s); }
    this.active.length = 0;
    for (const t of this.trails) t.clear();
  }
}
