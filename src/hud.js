// DOM heads-up display: gauges, compass, attitude indicator, objective marker,
// banners, the map and the adventure journal.
import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';
import { WORLD, POIS, RUNWAYS, CRYSTALS, ISLANDS } from './layout.js';
import { PHYS } from './plane.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = $('hud');
    this.compass = $('compass').getContext('2d');
    this.att = $('attitude').getContext('2d');
    this.speedArc = document.querySelector('#g-speed .g-val');
    this.stallArc = document.querySelector('#g-speed .g-stall');
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.reportTimer = 0;
    this.lastHint = '';
    this.showHints = true;
    this.cache = {};
  }

  set(id, text) {
    if (this.cache[id] === text) return;
    this.cache[id] = text;
    $(id).textContent = text;
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  setMission(m, stepIndex) {
    document.querySelector('.m-num').textContent = m.num ? `MISSION ${m.num}` : 'FREE FLIGHT';
    document.querySelector('.m-title').textContent = m.title;
    const step = m.steps[Math.min(stepIndex, m.steps.length - 1)];
    document.querySelector('.m-obj').textContent = stepIndex >= m.steps.length ? 'ミッション達成！' : step.text;
    const ul = document.querySelector('.m-steps');
    ul.innerHTML = '';
    if (m.steps.length > 1) {
      m.steps.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = i < stepIndex ? 'done' : i === stepIndex ? 'cur' : 'todo';
        li.textContent = i <= stepIndex ? s.text : '？？？';
        ul.appendChild(li);
      });
    }
    const card = $('mission-card');
    card.classList.remove('m-flash'); void card.offsetWidth; card.classList.add('m-flash');
  }

  hint(html) {
    if (!this.showHints) html = '';
    if (html === this.lastHint) return;
    this.lastHint = html;
    $('hint').innerHTML = html;
  }

  toast(text, dur = 2.2) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    this.toastTimer = dur;
  }

  banner(title, desc, kicker = 'DISCOVERY', dur = 5) {
    const b = $('banner');
    b.querySelector('.b-kicker').textContent = kicker;
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-desc').textContent = desc;
    b.classList.add('show');
    this.bannerTimer = dur;
  }

  report(html, dur = 4) {
    const r = $('report');
    r.innerHTML = html;
    r.classList.add('show');
    this.reportTimer = dur;
  }

  update(dt, g) {
    const fm = g.fm;
    const att = fm.attitude();
    const kmh = fm.speed * 3.6;
    this.set('v-speed', Math.round(kmh).toString());
    const frac = clamp(kmh / 300, 0, 1);
    this.speedArc.style.strokeDasharray = `${235.6 * frac} 314.2`;
    const stallFrac = clamp(98 / 300, 0, 1);
    this.stallArc.style.strokeDasharray = `${235.6 * stallFrac} 314.2`;
    this.speedArc.style.stroke = fm.stall ? '#ff6a55' : kmh < 105 && !fm.onGround ? '#ffb86a' : '';
    this.set('v-alt', Math.round(fm.pos.y - 1.5).toString());
    this.set('v-vs', (fm.onGround ? 0 : fm.vel.y).toFixed(1));
    this.set('v-agl', Math.max(0, Math.round(fm.onGround ? 0 : fm.agl ?? 0)).toString());
    this.set('v-thr', `${Math.round(fm.throttle * 100)}%`);
    $('v-thr-fill').style.height = `${fm.throttle * 100}%`;
    $('v-brake').classList.toggle('on', !!fm.brake);
    this.set('st-crystal', `${g.crystalsFound.size}/${CRYSTALS.length}`);
    this.set('st-disc', `${g.discovered.size}/${POIS.length}`);

    // warnings
    let warn = '';
    if (!fm.crashed) {
      if (fm.stall) warn = '失速！ 機首を下げて加速';
      else if (!fm.onGround && fm.agl < 40 && fm.vel.y < -7) warn = '高度注意 — 機首を上げて';
      else if (g.outOfBounds) warn = 'これ以上は進めない — 引き返そう';
    }
    this.set('warn', warn);

    this.drawCompass(att.heading, g);
    this.drawAttitude(att);
    this.updateMarker(g);
    this.updatePapi(g);
    // resonance
    const step = g.currentStep();
    const resEl = $('resonance');
    if (step && step.resonance) {
      resEl.classList.remove('hidden');
      const r = g.resonance();
      const bars = resEl.querySelectorAll('i');
      const lit = Math.round(r * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i < lit));
    } else resEl.classList.add('hidden');

    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('toast').classList.remove('show'); }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) $('banner').classList.remove('show'); }
    if (this.reportTimer > 0) { this.reportTimer -= dt; if (this.reportTimer <= 0) $('report').classList.remove('show'); }
  }

  drawCompass(hdg, g) {
    const c = this.compass, W = 560, H = 54;
    c.clearRect(0, 0, W, H);
    const grd = c.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, 'rgba(18,28,44,0)'); grd.addColorStop(0.15, 'rgba(18,28,44,0.45)');
    grd.addColorStop(0.85, 'rgba(18,28,44,0.45)'); grd.addColorStop(1, 'rgba(18,28,44,0)');
    c.fillStyle = grd; c.fillRect(0, 6, W, 30);
    const deg = hdg * 180 / Math.PI;
    const ppd = W / 120;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = Math.floor(deg - 62); d <= deg + 62; d++) {
      if (d % 5) continue;
      const x = W / 2 + (d - deg) * ppd;
      const dd = ((d % 360) + 360) % 360;
      const alpha = 1 - Math.abs(x - W / 2) / (W / 2);
      c.globalAlpha = clamp(alpha * 1.6, 0, 1);
      c.strokeStyle = '#fdf8ec'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x, 30); c.lineTo(x, dd % 15 ? 26 : 22); c.stroke();
      if (dd % 45 === 0) {
        const L = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[dd];
        c.font = dd % 90 === 0 ? 'bold 15px Cinzel, serif' : '12px Cinzel, serif';
        c.fillStyle = dd === 0 ? '#f2c46d' : '#fdf8ec';
        c.fillText(L, x, 14);
      }
    }
    c.globalAlpha = 1;
    // heading box
    c.fillStyle = '#f2c46d';
    c.beginPath(); c.moveTo(W / 2 - 6, 36); c.lineTo(W / 2 + 6, 36); c.lineTo(W / 2, 30); c.fill();
    c.font = 'bold 13px Cinzel, serif'; c.fillStyle = '#fdf8ec';
    c.fillText(String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0'), W / 2, 46);
    // objective marker
    const t = g.target;
    if (t) {
      const b = Math.atan2(t.x - g.fm.pos.x, -(t.z - g.fm.pos.z)) * 180 / Math.PI;
      let diff = ((b - deg + 540) % 360) - 180;
      const x = W / 2 + clamp(diff, -58, 58) * ppd;
      c.save(); c.translate(x, 30); c.rotate(Math.PI / 4);
      c.fillStyle = t.vague ? 'rgba(255,255,255,0.75)' : '#f2c46d';
      c.fillRect(-5, -5, 10, 10);
      c.restore();
      if (Math.abs(diff) > 58) {
        c.fillStyle = '#f2c46d'; c.font = 'bold 14px sans-serif';
        c.fillText(diff > 0 ? '▶' : '◀', diff > 0 ? W - 40 : 40, 30);
      }
    }
  }

  drawAttitude(att) {
    const c = this.att, S = 132, R = 62;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(S / 2, S / 2, R, 0, Math.PI * 2); c.clip();
    c.translate(S / 2, S / 2);
    c.rotate(-att.bank);
    const off = clamp(att.pitch * 180 / Math.PI, -40, 40) * 1.6;
    c.fillStyle = 'rgba(70,140,220,0.55)'; c.fillRect(-100, -200 + off, 200, 200);
    c.fillStyle = 'rgba(150,105,60,0.55)'; c.fillRect(-100, off, 200, 200);
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-100, off); c.lineTo(100, off); c.stroke();
    c.lineWidth = 1; c.font = '9px sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'left';
    for (const p of [-20, -10, 10, 20]) {
      const y = off - p * 1.6;
      c.beginPath(); c.moveTo(-14, y); c.lineTo(14, y); c.stroke();
      c.fillText(String(p), 17, y + 3);
    }
    c.restore();
    // fixed aircraft symbol
    c.strokeStyle = '#f2c46d'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(S / 2 - 32, S / 2); c.lineTo(S / 2 - 10, S / 2); c.lineTo(S / 2, S / 2 + 7); c.lineTo(S / 2 + 10, S / 2); c.lineTo(S / 2 + 32, S / 2); c.stroke();
    // bank scale
    c.save(); c.translate(S / 2, S / 2);
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.5;
    for (const a of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
      const r = a * Math.PI / 180;
      c.beginPath(); c.moveTo(Math.sin(r) * (R - 2), -Math.cos(r) * (R - 2)); c.lineTo(Math.sin(r) * (R - (a % 30 ? 6 : 10)), -Math.cos(r) * (R - (a % 30 ? 6 : 10))); c.stroke();
    }
    c.rotate(-att.bank);
    c.fillStyle = '#f2c46d';
    c.beginPath(); c.moveTo(0, -R + 11); c.lineTo(-5, -R + 19); c.lineTo(5, -R + 19); c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,236,200,0.4)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(S / 2, S / 2, R, 0, Math.PI * 2); c.stroke();
  }

  updateMarker(g) {
    const m = $('marker');
    const t = g.target;
    if (!t || g.cinematic) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    m.classList.toggle('vague', !!t.vague);
    _v.set(t.x, (t.y ?? 0) + 10, t.z);
    const cam = g.camera;
    _v.project(cam);
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight;
    if (behind) { x = innerWidth - x; y = innerHeight - y; }
    const pad = 60;
    const off = behind || x < pad || x > innerWidth - pad || y < pad || y > innerHeight - pad;
    if (off) {
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let dx = x - cx, dy = y - cy;
      if (behind && Math.abs(dy) < 1) dy = 1;
      const s = Math.min((cx - pad) / Math.abs(dx || 1e-3), (cy - pad) / Math.abs(dy || 1e-3));
      x = cx + dx * Math.min(s, 1e6); y = cy + dy * Math.min(s, 1e6);
    }
    m.classList.toggle('edge', off);
    const zoom = parseFloat(getComputedStyle(this.el).zoom) || 1;
    m.style.left = `${x / zoom}px`; m.style.top = `${y / zoom}px`;
    m.querySelector('.mk-label').textContent = t.label || '';
    const d = g.dist(t.x, t.z);
    m.querySelector('.mk-dist').textContent = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
  }

  updatePapi(g) {
    const el = $('papi-hud');
    const step = g.currentStep();
    const rwId = step && step.runway;
    if (!rwId || g.fm.onGround) { el.classList.add('hidden'); return; }
    const p = g.world.props.papis.filter((pp) => pp.rw.id === rwId)
      .map((pp) => ({ pp, d: Math.hypot(g.fm.pos.x - pp.x, g.fm.pos.z - pp.z), facing: -((g.fm.pos.x - pp.x) * pp.ld.x + (g.fm.pos.z - pp.z) * pp.ld.z) }))
      .filter((o) => o.facing > 0)
      .sort((a, b) => a.d - b.d)[0];
    if (!p || p.d > 4500) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const ang = Math.atan2(g.fm.pos.y - p.pp.y, p.d) * 180 / Math.PI;
    const th = [2.5, 2.83, 3.17, 3.5];
    const dots = el.querySelectorAll('.papi i');
    let reds = 0;
    dots.forEach((d, i) => { const white = ang > th[3 - i]; d.classList.toggle('red', !white); if (!white) reds++; });
    $('papi-txt').textContent = reds === 2 ? '適正な進入角' : reds > 2 ? '低すぎる' : '高すぎる';
  }
}

// ---------------------------------------------------------------- map
export class MapView {
  constructor(world) {
    this.world = world;
    const { data, res } = world.worldHeight;
    this.res = res;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = res;
    const g = this.base.getContext('2d');
    const img = g.createImageData(res, res);
    for (let i = 0; i < res * res; i++) {
      const h = data[i];
      let r, gg, b;
      if (h < 0) {
        const k = clamp(1 + h / 45, 0, 1);
        r = 40 + 60 * k * k; gg = 92 + 90 * k * k; b = 130 + 70 * k;
      } else if (h < 6) { r = 222; gg = 206; b = 160; } else {
        const k = clamp(h / 1500, 0, 1);
        r = 120 + 100 * k; gg = 150 + 50 * k - 20 * (1 - k); b = 90 + 130 * k;
        if (h > 1100) { r = 240; gg = 240; b = 240; }
      }
      // parchment tint
      img.data[i * 4] = r * 0.85 + 230 * 0.15; img.data[i * 4 + 1] = gg * 0.85 + 215 * 0.15; img.data[i * 4 + 2] = b * 0.85 + 180 * 0.15; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // hillshade lines
    this.fogRes = 96;
    this.explored = new Uint8Array(this.fogRes * this.fogRes);
  }

  toUV(x, z) {
    return { u: (x - WORLD.minX) / (WORLD.maxX - WORLD.minX), v: (z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ) };
  }

  reveal(x, z, radius = 3200, allowPhantom = false) {
    const n = this.fogRes;
    const cw = (WORLD.maxX - WORLD.minX) / n, ch = (WORLD.maxZ - WORLD.minZ) / n;
    const i0 = Math.floor((x - radius - WORLD.minX) / cw), i1 = Math.ceil((x + radius - WORLD.minX) / cw);
    const j0 = Math.floor((z - radius - WORLD.minZ) / ch), j1 = Math.ceil((z + radius - WORLD.minZ) / ch);
    for (let j = Math.max(0, j0); j < Math.min(n, j1); j++) {
      for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) {
        const cx = WORLD.minX + (i + 0.5) * cw, cz = WORLD.minZ + (j + 0.5) * ch;
        if (Math.hypot(cx - x, cz - z) > radius) continue;
        if (!allowPhantom && Math.hypot(cx - ISLANDS.phantom.x, cz - ISLANDS.phantom.z) < 3000) continue;
        this.explored[j * n + i] = 1;
      }
    }
  }

  draw(canvas, g) {
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, 0, 0, W, H);
    // fog of war
    const n = this.fogRes;
    const fog = document.createElement('canvas'); fog.width = fog.height = n;
    const fg = fog.getContext('2d');
    const img = fg.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { img.data[i * 4] = 214; img.data[i * 4 + 1] = 198; img.data[i * 4 + 2] = 166; img.data[i * 4 + 3] = this.explored[i] ? 0 : 235; }
    fg.putImageData(img, 0, 0);
    c.drawImage(fog, 0, 0, W, H);
    // paper grid
    c.strokeStyle = 'rgba(90,60,20,0.15)'; c.lineWidth = 1;
    for (let k = 1; k < 8; k++) { c.beginPath(); c.moveTo(k * W / 8, 0); c.lineTo(k * W / 8, H); c.stroke(); c.beginPath(); c.moveTo(0, k * H / 8); c.lineTo(W, k * H / 8); c.stroke(); }
    const P = (x, z) => { const { u, v } = this.toUV(x, z); return [u * W, v * H]; };
    const isExplored = (x, z) => {
      const { u, v } = this.toUV(x, z);
      const i = Math.floor(u * n), j = Math.floor(v * n);
      return i >= 0 && j >= 0 && i < n && j < n && this.explored[j * n + i];
    };
    // runways
    for (const k in RUNWAYS) {
      const rw = RUNWAYS[k];
      if (!isExplored(rw.x, rw.z)) continue;
      const [x, y] = P(rw.x, rw.z);
      c.save(); c.translate(x, y); c.rotate(rw.heading * Math.PI / 180);
      c.fillStyle = '#2a2a2a'; c.fillRect(-2.5, -rw.length / (WORLD.maxZ - WORLD.minZ) * H / 2 - 3, 5, rw.length / (WORLD.maxZ - WORLD.minZ) * H + 6);
      c.restore();
      c.fillStyle = '#3a2a14'; c.font = '11px "Zen Maru Gothic", sans-serif'; c.textAlign = 'left';
      c.fillText('✈ ' + rw.name, x + 8, y + 16);
    }
    // discovered places
    for (const p of POIS) {
      if (!g.discovered.has(p.id)) continue;
      const [x, y] = P(p.x, p.z);
      c.fillStyle = '#c98f34';
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3a2a14'; c.font = 'bold 12px "Zen Maru Gothic", sans-serif'; c.textAlign = 'center';
      c.fillText(p.name, x, y - 8);
    }
    for (const cr of g.world.props.crystals) {
      if (!cr.collected) continue;
      const [x, y] = P(cr.x, cr.z);
      c.fillStyle = '#3fb8e8';
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillRect(-3, -3, 6, 6); c.restore();
    }
    // target
    if (g.target) {
      const [x, y] = P(g.target.x, g.target.z);
      c.strokeStyle = '#b4472f'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.stroke();
    }
    // aircraft
    const [px, py] = P(g.fm.pos.x, g.fm.pos.z);
    const hdg = g.fm.attitude().heading;
    c.save(); c.translate(px, py); c.rotate(hdg);
    c.fillStyle = '#b4472f';
    c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath(); c.fill();
    c.restore();
    // compass rose
    c.fillStyle = '#3a2a14'; c.font = 'bold 16px Cinzel, serif'; c.textAlign = 'center';
    c.fillText('N', W - 30, 30);
    c.beginPath(); c.moveTo(W - 30, 36); c.lineTo(W - 25, 50); c.lineTo(W - 35, 50); c.fill();
  }

  journal(g) {
    const ul = $('journal-list');
    ul.innerHTML = '';
    for (const p of POIS) {
      const li = document.createElement('li');
      if (g.discovered.has(p.id)) { li.innerHTML = `<b>${p.name}</b>${p.desc}`; } else { li.className = 'unknown'; li.innerHTML = '<b>？？？</b>まだ見ぬ場所'; }
      ul.appendChild(li);
    }
    const cl = $('crystal-list');
    cl.innerHTML = '';
    for (const c of g.world.props.crystals) {
      const li = document.createElement('li');
      li.innerHTML = c.collected ? `<b>◆ 入手済み</b>${c.hint}` : `<b>◇ 未発見</b>${g.discovered.size >= 3 ? 'ヒント：' + c.hint : '？？？'}`;
      if (!c.collected) li.className = 'unknown';
      cl.appendChild(li);
    }
  }
}
