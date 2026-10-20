// Skybound Horizons — game bootstrap, state machine and main loop.
import * as THREE from 'three';
import { World } from './world.js';
import { buildPlaneModel, FlightModel, WHEELS, GEAR_H } from './plane.js';
import { Input } from './input.js';
import { CameraRig, CAM_LABELS } from './camera.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { HUD, MapView } from './hud.js';
import { MISSIONS, FREE_FLIGHT, takeoffHint } from './missions.js';
import { Autopilot } from './autopilot.js';
import { RUNWAYS, POIS, RUINS, ISLANDS, WORLD, runwayLocal } from './layout.js';
import { clamp, smoothstep, lerp } from './noise.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SAVE_KEY = 'skybound-horizons-save-v1';
const PHYS_DT = 1 / 120;

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}
function writeSave(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const tick = () => new Promise((r) => setTimeout(r, 16));

class Game {
  async init() {
    const progress = (p, t) => { $('load-fill').style.width = `${p * 100}%`; if (t) $('load-text').textContent = t; };
    progress(0.05, 'レンダラーを準備しています…');
    await tick();
    this.quality = params.get('quality') || 'medium';
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : this.quality === 'low' ? 0.75 : 1.25));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = this.quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('app').appendChild(renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 60000);
    window.addEventListener('resize', () => {
      renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    });

    progress(0.15, '島と山脈を生成しています…');
    await tick();
    this.world = new World(this.scene, renderer);
    progress(0.7, '機体を整備しています…');
    await tick();

    this.model = buildPlaneModel();
    this.scene.add(this.model.root);
    this.fm = new FlightModel();
    this.envMap();
    this.input = new Input();
    this.rig = new CameraRig(this.camera);
    this.audio = new AudioEngine();
    this.fx = new Effects(this.scene);
    this.hud = new HUD();
    this.map = new MapView(this.world);
    this.autopilot = new Autopilot(this);
    this.save = loadSave();
    this.discovered = new Set(this.save.discovered || []);
    this.crystalsFound = new Set(this.save.crystals || []);
    this.cleared = new Set(this.save.cleared || []);
    for (const c of this.world.props.crystals) c.collected = this.crystalsFound.has(c.id), c.g.visible = !c.collected;
    if (this.discovered.has('ruins')) this.world.props.ruins.active = 1;
    if (this.discovered.has('secret')) this.world.props.phantom.lampsOn = 1;
    for (const id of this.save.explored || []) this.map.explored[id] = 1;
    this.settings = { music: 0.5, sfx: 0.8, invert: false, assist: true, hints: true, ...(this.save.settings || {}) };
    this.applySettings();

    this.env = {
      groundHeight: (x, z) => this.groundAt(x, z),
      isWater: (x, z) => this.world.terrain.height(x, z) < 0.15 && !this.runwayAt(x, z),
      groundNormal: (x, z) => (this.runwayAt(x, z) ? new THREE.Vector3(0, 1, 0) : this.world.terrain.normal(x, z, new THREE.Vector3())),
      surfaceAt: (x, z) => this.surfaceAt(x, z),
      hitsCollider: (p) => this.hitsCollider(p),
      water: true,
    };

    progress(0.9, '空模様を整えています…');
    await tick();
    this.state = 'title';
    this.mission = null;
    this.stepIndex = 0;
    this.time = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    this.snapshots = [];
    this.lastSnap = 0;
    this.titleT = 0;
    this.bindUI();
    this.setupTitleScene();
    // warm up shaders
    renderer.compile(this.scene, this.camera);
    progress(1, '準備完了');
    await tick();
    this.showScreen('s-title');
    this.last = performance.now();
    this.manual = params.has('capture');
    if (!this.manual) requestAnimationFrame(this.loop);
    window.__sky = this.testApi();
    window.__skyReady = true;
  }

  envMap() {
    // Image-based lighting for the aircraft so it picks up sky colour.
    const pm = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    const skyMesh = this.world.sky.clone();
    skyMesh.material = this.world.sky.material;
    skyScene.add(skyMesh);
    if (this.envRT) this.envRT.dispose();
    this.envRT = pm.fromScene(skyScene, 0.04);
    for (const m of this.model.mats) { m.envMap = this.envRT.texture; m.envMapIntensity = 0.9; m.needsUpdate = true; }
    pm.dispose();
  }

  setTime(key) {
    this.world.setTime(key);
    this.envMap();
    this.audio.setMood(key === 'golden' ? 'day' : key);
  }

  // ---------------------------------------------------------------- world queries
  runwayAt(x, z) {
    for (const k in RUNWAYS) {
      const rw = RUNWAYS[k];
      const l = runwayLocal(rw, x, z);
      if (Math.abs(l.along) <= rw.length / 2 + 2 && Math.abs(l.across) <= rw.width / 2 + 6) return rw;
    }
    return null;
  }
  // runway plus a little overrun: stopping here counts as a landing on that runway
  runwayZone(x, z) {
    for (const k in RUNWAYS) {
      const rw = RUNWAYS[k];
      const l = runwayLocal(rw, x, z);
      if (Math.abs(l.along) <= rw.length / 2 + 90 && Math.abs(l.across) <= rw.width / 2 + 20) return rw;
    }
    return null;
  }
  nearestRunway() {
    let best = null, bd = 1e9;
    for (const k in RUNWAYS) { const rw = RUNWAYS[k]; const d = this.dist(rw.x, rw.z); if (d < bd) { bd = d; best = rw; } }
    return best;
  }
  groundHeight(x, z) { return this.groundAt(x, z); }
  groundAt(x, z) {
    const rw = this.runwayAt(x, z);
    if (rw) return rw.elev;
    return this.world.terrain.height(x, z);
  }
  surfaceAt(x, z) {
    const rw = this.runwayAt(x, z);
    if (rw) return rw.surface;
    for (const k in RUNWAYS) {
      const r = RUNWAYS[k]; const l = runwayLocal(r, x, z);
      if (Math.abs(l.along) <= r.length / 2 + r.pad && Math.abs(l.across) <= r.width / 2 + r.padSide) return 'grass';
    }
    return 'rough';
  }
  hitsCollider(p) {
    for (const c of this.world.colliders) {
      if (c.type === 'cyl') {
        if (p.y > c.y0 && p.y < c.y1 && Math.hypot(p.x - c.x, p.z - c.z) < c.r) return true;
      } else if (c.type === 'sphere') {
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        if (dx * dx + dy * dy + dz * dz < c.r * c.r) return true;
      } else if (c.type === 'box') {
        if (p.y > c.y0 && p.y < c.y1 && Math.abs(p.x - c.x) < c.hx && Math.abs(p.z - c.z) < c.hz) return true;
      } else if (c.type === 'obox') {
        const h = c.heading * Math.PI / 180;
        const dx = p.x - c.x, dz = p.z - c.z;
        const al = dx * Math.sin(h) - dz * Math.cos(h), ac = dx * Math.cos(h) + dz * Math.sin(h);
        if (p.y > c.y0 && p.y < c.y1 && Math.abs(ac) < c.hx && Math.abs(al) < c.hz) return true;
      }
    }
    return false;
  }
  dist(x, z) { return Math.hypot(this.fm.pos.x - x, this.fm.pos.z - z); }
  resonance() {
    const d = Math.hypot(this.fm.pos.x - RUINS.x, this.fm.pos.z - RUINS.z, (this.fm.pos.y - RUINS.elev) * 0.5);
    return clamp(1 - (d - 400) / 5200, 0, 1);
  }
  currentStep() { return this.mission ? this.mission.steps[this.stepIndex] : null; }
  get target() {
    const s = this.currentStep();
    if (!s || !s.target || this.state === 'title') return null;
    return s.target(this);
  }

  // ---------------------------------------------------------------- UI
  showScreen(id) {
    document.querySelectorAll('#screens .screen').forEach((s) => s.classList.toggle('show', s.id === id));
    this.screen = id;
  }

  bindUI() {
    document.addEventListener('pointerdown', () => this.audio.start(), { once: false });
    document.addEventListener('keydown', () => this.audio.start());
    document.querySelectorAll('#screens button[data-act]').forEach((b) => {
      b.addEventListener('click', () => { this.audio.start(); this.audio.ui(); this.action(b.dataset.act); });
    });
    // mission cards
    const cards = $('mission-cards');
    const art = {
      dawn: '<svg viewBox="0 0 290 150"><circle cx="230" cy="96" r="22" fill="#ffe2b0" opacity=".9"/><path d="M0 108 L60 100 L80 104 L140 98 L170 106 L290 104 L290 150 L0 150Z" fill="#2c5f6f"/><path d="M180 104 l18 -22 l8 0 l4 22z" fill="#3a5a4a"/><rect x="200" y="62" width="4" height="22" fill="#f4f1ea"/><path d="M40 70 l30 -4 l-6 4 l14 0 l-14 3 l6 4z" fill="#fff" opacity=".9"/></svg>',
      day: '<svg viewBox="0 0 290 150"><path d="M0 95 L50 60 L80 78 L120 30 L160 70 L200 45 L240 80 L290 62 L290 100 L0 100Z" fill="#7a8ca0"/><path d="M110 40 L120 30 L130 42Z" fill="#fff"/><ellipse cx="80" cy="96" rx="120" ry="10" fill="#fff" opacity=".95"/><ellipse cx="220" cy="98" rx="110" ry="9" fill="#fff" opacity=".9"/><rect x="138" y="108" width="6" height="22" fill="#d6c9a8"/><rect x="152" y="108" width="6" height="22" fill="#d6c9a8"/><rect x="134" y="104" width="28" height="5" fill="#bfb08e"/></svg>',
      sunset: '<svg viewBox="0 0 290 150"><circle cx="60" cy="98" r="26" fill="#ffd090" opacity=".9"/><path d="M150 100 Q190 40 230 100Z" fill="#3a4a6a"/><path d="M175 100 Q190 70 205 100Z" fill="#5a6a8a"/><path d="M60 92 L290 20" stroke="#ffd9a0" stroke-width="3" opacity=".6"/><ellipse cx="190" cy="98" rx="90" ry="12" fill="#ffc8a8" opacity=".35"/></svg>',
    };
    MISSIONS.forEach((m) => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = `<div class="art ${m.time}">${art[m.time]}</div><div class="body"><div class="num">MISSION ${m.num} · ${m.en.toUpperCase()}</div><div class="t">${m.title}</div><div class="d">${m.blurb}</div><div class="badge" data-badge="${m.id}"></div></div>`;
      c.addEventListener('click', () => { this.audio.start(); this.audio.ui(); this.openIntro(m); });
      cards.appendChild(c);
    });
    // free flight options
    this.freeOpts = { start: 'home', time: 'golden' };
    const fs = $('free-start'), ft = $('free-time');
    const starts = [['home', '暁の飛行場'], ['lighthouse', '灯台の島'], ['foothill', '山麓の滑走路'], ['secret', '秘密の滑走路'], ['air', '上空から']];
    const times = [['dawn', '朝'], ['day', '昼'], ['golden', '夕方'], ['sunset', '夕暮れ']];
    const mk = (parent, list, key) => list.forEach(([v, l]) => {
      const b = document.createElement('button'); b.textContent = l; b.dataset.v = v;
      if (this.freeOpts[key] === v) b.classList.add('sel');
      b.addEventListener('click', () => {
        if (key === 'start' && v === 'secret' && !this.discovered.has('secret')) { b.textContent = '？？？（未発見）'; return; }
        this.freeOpts[key] = v; parent.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); this.audio.ui();
      });
      parent.appendChild(b);
    });
    mk(fs, starts, 'start'); mk(ft, times, 'time');
    // settings
    $('set-music').addEventListener('input', (e) => { this.settings.music = +e.target.value; this.applySettings(); });
    $('set-sfx').addEventListener('input', (e) => { this.settings.sfx = +e.target.value; this.applySettings(); });
    $('set-invert').addEventListener('change', (e) => { this.settings.invert = e.target.checked; this.applySettings(); });
    $('set-assist').addEventListener('change', (e) => { this.settings.assist = e.target.checked; this.applySettings(); });
    $('set-hints').addEventListener('change', (e) => { this.settings.hints = e.target.checked; this.applySettings(); });
    $('set-quality').value = this.quality;
    $('set-quality').addEventListener('change', (e) => { const u = new URL(location.href); u.searchParams.set('quality', e.target.value); location.href = u.toString(); });
  }

  applySettings() {
    const s = this.settings;
    this.audio.setVolumes(s.music, s.sfx);
    this.input.invertPitch = s.invert;
    this.fm.assist = s.assist;
    this.hud.showHints = s.hints;
    $('set-music').value = s.music; $('set-sfx').value = s.sfx;
    $('set-invert').checked = s.invert; $('set-assist').checked = s.assist; $('set-hints').checked = s.hints;
    this.persist();
  }

  persist() {
    if (!this.discovered) return;
    const explored = [];
    if (this.map) this.map.explored.forEach((v, i) => { if (v) explored.push(i); });
    writeSave({
      discovered: [...this.discovered], crystals: [...this.crystalsFound], cleared: [...this.cleared],
      settings: this.settings, explored,
    });
  }

  action(act) {
    const back = this.prevScreen || 's-title';
    switch (act) {
      case 'adventure':
        document.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = this.cleared.has(b.dataset.badge) ? '✓ クリア済み' : ''; });
        this.prevScreen = 's-title'; this.showScreen('s-select'); break;
      case 'free': this.prevScreen = 's-title'; this.showScreen('s-free'); break;
      case 'help': this.prevScreen = this.screen; this.showScreen('s-help'); break;
      case 'settings': this.prevScreen = this.screen; this.showScreen('s-settings'); break;
      case 'back':
        if (this.screen === 's-intro') { this.showScreen(this.introFrom || 's-select'); break; }
        this.showScreen(this.state === 'pause' ? 's-pause' : back); this.prevScreen = 's-title'; break;
      case 'go': this.startMission(this.pendingMission); break;
      case 'free-go': this.startFree(); break;
      case 'resume': this.resume(); break;
      case 'checkpoint': this.retry(true); break;
      case 'restart': this.retry(false); break;
      case 'title': this.toTitle(); break;
      case 'close-map': this.closeMap(); break;
      case 'free-from-end': this.freeOpts = { start: 'secret', time: 'sunset' }; this.startFree(); break;
      default: break;
    }
  }

  openIntro(m, from = 's-select') {
    this.pendingMission = m;
    this.introFrom = from;
    const s = $('s-intro');
    s.querySelector('.j-num').textContent = m.num ? `MISSION ${m.num} · ${m.en.toUpperCase()}` : 'FREE FLIGHT';
    s.querySelector('.j-title').textContent = m.title;
    s.querySelector('.j-text').innerHTML = m.intro.map((p) => `<p>${p}</p>`).join('');
    s.querySelector('.j-steps').innerHTML = m.steps.map((st, i) => `<li>${i === 0 || st.text.length < 0 ? st.text : (i === 1 ? st.text : '？？？')}</li>`).join('');
    this.showScreen('s-intro');
  }

  // ---------------------------------------------------------------- flow
  setupTitleScene() {
    this.setTime('dawn');
    this.fm.placeOnRunway(RUNWAYS.home, -470);
    this.syncModel(0);
    this.rig.mode = 'chase';
    this.rig.reset(this.fm);
    this.audio.setMood('title');
  }

  startMission(m) {
    this.mission = m;
    this.stepIndex = 0;
    this.setTime(m.time);
    this.missionStats = { start: this.time, discoveries: [], crystals: 0, landing: null, crashes: 0 };
    this.placeAtStart();
    this.state = 'play';
    this.showScreen(null);
    this.hud.show(true);
    this.hud.setMission(m, 0);
    this.fx.reset();
    this.snapshots = [];
    this.liftoffShown = false;
    this.stoppedOn = null;
    this.world.props.ruins.guide = m.id === 'm3' ? 1 : 0;
    if (m.id === 'm3') this.world.props.ruins.active = Math.max(this.world.props.ruins.active, 1);
    this.flash();
    this.hud.toast(m.num ? `MISSION ${m.num}「${m.title}」` : 'フリーフライト', 3);
    if (!this.discovered.has('home')) this.discover(POIS[0], true);
  }

  startFree() {
    const m = { ...FREE_FLIGHT, time: this.freeOpts.time, start: this.freeOpts.start === 'air' ? { air: true } : { runway: this.freeOpts.start, along: -RUNWAYS[this.freeOpts.start].length / 2 + 40 } };
    this.startMission(m);
  }

  placeAtStart() {
    const s = this.mission.start;
    if (s.air) {
      this.fm.placeInAir(new THREE.Vector3(0, 450, 1500), 0, 50);
      this.runHeading = 0;
    } else {
      const rw = RUNWAYS[s.runway];
      this.fm.placeOnRunway(rw, s.along ?? -rw.length / 2 + 40, !!s.reverse);
      this.runHeading = this.fm.heading;
    }
    this.fm.assist = this.settings.assist;
    this.syncModel(0);
    this.rig.mode = this.rig.mode === 'cockpit' ? 'cockpit' : this.rig.mode;
    this.rig.reset(this.fm);
    this.crashTimer = 0;
    this.stoppedOn = null;
  }

  flash() {
    const f = $('fade');
    f.style.transition = 'none'; f.style.opacity = 1;
    requestAnimationFrame(() => { f.style.transition = 'opacity 1.2s'; f.style.opacity = 0; });
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.showScreen('s-pause');
  }
  resume() {
    if (this.state !== 'pause') return;
    this.state = 'play';
    this.showScreen(null);
  }

  toTitle() {
    this.state = 'title';
    this.mission = null;
    this.hud.show(false);
    this.autopilot.stop();
    this.input.override = null;
    this.setupTitleScene();
    this.showScreen('s-title');
  }

  retry(fromCheckpoint) {
    if (!this.mission) return;
    this.fx.reset();
    this.timeScale = 1; this.slowmo = 0;
    let snap = null;
    if (fromCheckpoint) {
      const now = this.time;
      for (let i = this.snapshots.length - 1; i >= 0; i--) {
        if (now - this.snapshots[i].t > 5) { snap = this.snapshots[i]; break; }
      }
      if (!snap && this.snapshots.length) snap = this.snapshots[0];
    }
    if (snap) {
      this.fm.placeInAir(snap.pos, snap.heading, snap.speed);
      this.fm.throttle = this.fm.rpm = snap.throttle;
      this.snapshots = this.snapshots.filter((s) => s.t <= snap.t);
      this.snapshots.forEach((s) => { s.t -= 0; });
      this.syncModel(0);
      this.rig.reset(this.fm);
      this.stoppedOn = null;
      this.crashTimer = 0;
    } else {
      if (!fromCheckpoint) { this.stepIndex = 0; this.hud.setMission(this.mission, 0); this.liftoffShown = false; }
      this.placeAtStart();
      this.snapshots = [];
      if (fromCheckpoint && this.stepIndex === 1 && this.mission.steps[0].check(this) === false) { /* keep */ }
    }
    this.state = 'play';
    this.showScreen(null);
    this.hud.show(true);
    this.flash();
    this.hud.toast(snap ? '少し前の地点から再開' : 'ミッションの最初から再開', 2.5);
  }

  openMap() {
    if (this.state !== 'play') return;
    this.state = 'map';
    this.map.draw($('map'), this);
    this.map.journal(this);
    this.showScreen('s-map');
  }
  closeMap() {
    if (this.state !== 'map') return;
    this.state = 'play';
    this.showScreen(null);
  }

  // ---------------------------------------------------------------- gameplay
  discover(p, quiet = false) {
    this.discovered.add(p.id);
    if (this.missionStats) this.missionStats.discoveries.push(p.name);
    this.persist();
    if (p.id === 'ruins') {
      this.ruinsAwaken = 1;
    }
    if (p.id === 'secret') this.world.props.phantom.lampsOn = 1;
    if (p.id === 'phantom') this.map.reveal(p.x, p.z, 3200, true);
    if (quiet) return;
    this.hud.banner(p.name, p.desc, 'DISCOVERY');
    this.audio.discovery();
    if (!this.fm.onGround && this.fm.speed > 20 && p.id !== 'home') {
      this.rig.play('discovery', { dur: 4.2, target: new THREE.Vector3(p.x, p.y, p.z) });
      this.slowmo = 3.2;
    }
  }

  collect(c) {
    c.collected = true;
    c.g.visible = false;
    this.crystalsFound.add(c.id);
    if (this.missionStats) this.missionStats.crystals++;
    this.fx.sparkle(new THREE.Vector3(c.x, c.y, c.z));
    this.audio.crystal();
    this.hud.toast(`スカイクリスタルを手に入れた！（${this.crystalsFound.size}/8）`, 3);
    this.persist();
  }

  advanceStep() {
    this.stepIndex++;
    this.audio.objective();
    if (this.stepIndex >= this.mission.steps.length) {
      this.completeMission();
      return;
    }
    this.hud.setMission(this.mission, this.stepIndex);
    this.hud.toast('目標達成！ 次の目的へ', 2.4);
  }

  completeMission() {
    const m = this.mission;
    this.state = 'complete';
    this.cleared.add(m.id);
    this.persist();
    this.hud.setMission(m, m.steps.length);
    this.audio.success();
    this.rig.play('landed', { dur: 999, hold: true, a0: this.fm.attitude().heading + 2.2 });
    this.completeTimer = 3.2;
  }

  showResult() {
    const m = this.mission;
    const s = $('s-result');
    s.querySelector('.r-title').textContent = m.title;
    const L = this.missionStats.landing;
    s.querySelector('.r-grade').textContent = L ? `着陸評価：${L.grade.label}` : '';
    const t = Math.round(this.time - this.missionStats.start);
    const disc = this.missionStats.discoveries.filter((d) => d !== '暁の飛行場');
    s.querySelector('.r-stats').innerHTML = [
      `飛行時間：${Math.floor(t / 60)}分${String(t % 60).padStart(2, '0')}秒`,
      L ? `接地時の降下率：${L.vs.toFixed(1)} m/s ・ 接地速度：${Math.round(L.speed * 3.6)} km/h` : '',
      `新たな発見：${disc.length ? disc.join('、') : 'なし'}`,
      `スカイクリスタル：${this.crystalsFound.size}/8（今回 +${this.missionStats.crystals}）`,
      this.missionStats.crashes ? `墜落からの再開：${this.missionStats.crashes} 回` : '',
    ].filter(Boolean).join('<br>');
    s.querySelector('.r-outro').textContent = m.outro || '';
    const btns = $('result-btns');
    btns.innerHTML = '';
    const add = (label, fn, primary) => { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = () => { this.audio.ui(); fn(); }; btns.appendChild(b); };
    const idx = MISSIONS.findIndex((x) => x.id === m.id);
    if (m.ending) add('エンディングへ', () => this.showEnding(), true);
    else if (idx >= 0 && idx < MISSIONS.length - 1) add('次の冒険へ', () => this.openIntro(MISSIONS[idx + 1], 's-title'), true);
    add('もう一度', () => this.startMission(m));
    add('タイトルへ', () => this.toTitle());
    this.hud.show(false);
    this.showScreen('s-result');
    this.state = 'result';
  }

  showEnding() {
    this.state = 'ending';
    this.hud.show(false);
    this.showScreen('s-ending');
    this.rig.play('ending', { dur: 999, hold: true });
  }

  handleEvents() {
    const evs = this.fm.events.splice(0);
    for (const e of evs) {
      if (e.type === 'liftoff') {
        if (!this.liftoffShown) {
          this.liftoffShown = true;
          this.rig.play('liftoff', { dur: 4.2 });
          this.hud.toast('離陸！', 2);
        }
      } else if (e.type === 'touchdown') {
        const info = e.info;
        const strength = clamp(-info.vs / 5, 0, 1);
        this.audio.touchdown(strength);
        this.rig.addShake(0.15 + strength * 0.5);
        const pts = WHEELS.slice(0, 2).map((w) => w.clone().applyQuaternion(this.fm.quat).add(this.fm.pos));
        this.fx.tyreSmoke(pts);
        const onRw = this.runwayAt(info.x, info.z);
        if (this.mission) this.missionStats.landing = info;
        this.hud.report(`<div class="rg">${info.grade.label}</div>降下率 ${info.vs.toFixed(1)} m/s ・ ${Math.round(info.speed * 3.6)} km/h${onRw ? '' : ' ・ 滑走路外'}`, 4);
      } else if (e.type === 'crash') {
        const water = e.kind === 'water';
        this.fx.crash(this.fm.pos.clone(), water);
        if (water) this.audio.splash(); else this.audio.crash();
        this.rig.play('crash', { dur: 999, hold: true });
        this.rig.addShake(1);
        this.crashTimer = 1.6;
        this.missionStats && this.missionStats.crashes++;
        $('crash-reason').textContent = e.reason;
      }
    }
  }

  updateGameplay(dt) {
    const fm = this.fm;
    // discoveries
    for (const p of POIS) {
      if (this.discovered.has(p.id)) continue;
      const d = this.dist(p.x, p.z);
      if (d > p.radius) continue;
      if (p.maxAlt && fm.pos.y > p.maxAlt) continue;
      if (p.minAlt && fm.pos.y < p.minAlt) continue;
      if (p.id === 'secret' && !this.discovered.has('phantom')) continue;
      this.discover(p);
    }
    // crystals
    for (const c of this.world.props.crystals) {
      if (c.collected) continue;
      const dx = fm.pos.x - c.x, dy = fm.pos.y - c.y, dz = fm.pos.z - c.z;
      if (dx * dx + dy * dy + dz * dz < 20 * 20) this.collect(c);
    }
    // ruins awakening animation
    const R = this.world.props.ruins;
    if (this.discovered.has('ruins')) R.active = Math.min(1, R.active + dt * 0.3);
    // stopped on a runway?
    const prevStop = this.stoppedOn;
    this.stoppedOn = null;
    if (fm.onGround && !fm.crashed && (fm.groundSpeed || 0) < 0.8) {
      const rw = this.runwayZone(fm.pos.x, fm.pos.z);
      if (rw && (this.time - (this.lastAirTime || -99) < 600)) this.stoppedOn = rw.id;
    }
    if (!fm.onGround) this.lastAirTime = this.time;
    // checkpoint snapshots
    const att = fm.attitude();
    if (!fm.onGround && !fm.crashed && fm.agl > 70 && fm.speed > 35 && Math.abs(att.bank) < 0.7 && Math.abs(att.pitch) < 0.35 && !fm.stall) {
      if (this.time - this.lastSnap > 1.5) {
        this.lastSnap = this.time;
        this.snapshots.push({ t: this.time, pos: fm.pos.clone(), heading: att.heading, speed: fm.speed, throttle: fm.throttle });
        if (this.snapshots.length > 40) this.snapshots.shift();
      }
    }
    // map exploration
    this.exploreTimer = (this.exploreTimer || 0) - dt;
    if (this.exploreTimer <= 0) {
      this.exploreTimer = 1;
      this.map.reveal(fm.pos.x, fm.pos.z, 2600 + clamp(fm.pos.y, 0, 1500), this.discovered.has('phantom'));
    }
    // out of bounds
    const B = WORLD.boundaryCenter;
    this.outOfBounds = Math.hypot(fm.pos.x - B.x, fm.pos.z - B.z) > WORLD.boundaryRadius;
    // mission step
    const step = this.currentStep();
    if (step && this.state === 'play' && step.check(this)) this.advanceStep();
    if (step && this.state === 'play') {
      // after a restart on the runway, always coach the take-off first
      const onStartRoll = fm.onGround && !step.runway && this.stepIndex > 1 && (fm.groundSpeed || 0) < 35;
      this.hud.hint(onStartRoll ? takeoffHint(this) : step.hint ? step.hint(this) : '');
    }
  }

  syncModel(dt) {
    const fm = this.fm, m = this.model;
    m.root.position.copy(fm.pos);
    m.root.quaternion.copy(fm.quat);
    // propeller
    this.propAngle = (this.propAngle || 0) + dt * (fm.crashed ? 0 : 8 + fm.rpm * 160);
    m.prop.rotation.z = this.propAngle;
    m.discMat.opacity = clamp((fm.rpm - 0.3) * 0.25, 0, 0.18);
    m.prop.visible = !fm.crashed;
    // control surfaces
    const inp = this.lastInput || { pitch: 0, roll: 0, yaw: 0 };
    const u = m.root.userData;
    if (u.elevator) u.elevator.rotation.x = -inp.pitch * 0.35;
    if (u.rudder) u.rudder.rotation.y = -inp.yaw * 0.4;
    if (u.ailL) u.ailL.rotation.x = inp.roll * 0.3;
    if (u.ailR) u.ailR.rotation.x = -inp.roll * 0.3;
    // wheels spin
    const ws = (fm.groundSpeed || 0) * dt / 0.3;
    for (const w of m.wheels) w.rotation.x -= ws;
    // suspension
    m.gear.position.y = fm.onGround ? fm.suspension * 0.12 : 0;
    if (fm.crashed) {
      m.root.rotateZ(0.3); m.root.rotateX(-0.15);
    }
  }

  frame(dt) {
    this.input.endFrameNeeded = true;
    const inp = this.input;
    // global keys
    if (this.state === 'play') {
      if (inp.hit('Escape') || inp.hit('KeyP')) this.pause();
      else if (inp.hit('KeyM')) this.openMap();
      else if (inp.hit('KeyC')) { const m = this.rig.cycle(); this.hud.toast(CAM_LABELS[m], 1.4); }
      else if (inp.hit('KeyH')) { this.settings.hints = !this.settings.hints; this.applySettings(); }
    } else if (this.state === 'pause') {
      if (inp.hit('Escape') || inp.hit('KeyP')) this.resume();
    } else if (this.state === 'map') {
      if (inp.hit('KeyM') || inp.hit('Escape')) this.closeMap();
    } else if (this.state === 'crash') {
      if (inp.hit('Enter')) this.retry(true);
      else if (inp.hit('Backspace')) this.retry(false);
    } else if (this.state === 'title' && this.screen === 's-intro' && inp.hit('Enter')) {
      this.startMission(this.pendingMission);
    }

    const running = this.state === 'play' || this.state === 'complete' || this.state === 'crash' || this.state === 'title' || this.state === 'ending' || this.state === 'result';
    if (this.slowmo > 0) { this.slowmo -= dt; this.timeScale = lerp(this.timeScale, 0.4, 0.1); } else this.timeScale = lerp(this.timeScale, 1, 0.08);
    const sdt = dt * (this.state === 'play' ? this.timeScale : 1);
    if (running && this.state !== 'title') {
      this.time += sdt;
      // flight
      let control = this.state === 'play' ? inp.sample(dt) : { pitch: 0, roll: 0, yaw: 0, throttleAxis: -1, brake: true };
      if (this.autopilot.mode !== 'idle' && this.state === 'play') control = this.autopilot.update(sdt);
      this.lastInput = control;
      if (!this.fm.crashed) {
        this.physAcc = (this.physAcc || 0) + sdt;
        let n = 0;
        while (this.physAcc >= PHYS_DT && n < 30) { this.fm.step(PHYS_DT, control, this.env); this.physAcc -= PHYS_DT; n++; }
        if (n >= 30) this.physAcc = 0;
      }
      this.handleEvents();
      if (this.state === 'play') this.updateGameplay(sdt);
      if (this.fm.crashed && this.state === 'play') {
        this.crashTimer -= dt;
        if (this.crashTimer <= 0) { this.state = 'crash'; this.showScreen('s-crash'); }
      }
      if (this.state === 'complete') {
        this.completeTimer -= dt;
        if (this.completeTimer <= 0) this.showResult();
      }
    }
    if (this.state === 'title') {
      // slow cinematic orbit around the parked aircraft
      this.titleT += dt;
      const a = this.titleT * 0.035 + 2.25;
      const p = this.fm.pos;
      this.camera.position.set(p.x + Math.sin(a) * 15, p.y + 0.6 + Math.sin(this.titleT * 0.2) * 0.4, p.z + Math.cos(a) * 15);
      this.camera.up.set(0, 1, 0);
      // keep the aircraft on the right third of the screen, sky above
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      this.camera.lookAt(p.x - side.x * 5.5, p.y + 2.6, p.z - side.z * 5.5);
      if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
      this.lastInput = { pitch: 0, roll: 0, yaw: 0 };
    } else {
      this.rig.update(dt, this.fm, this.time, this);
    }
    this.cinematic = this.rig.blend > 0.3;
    this.syncModel(sdt);
    const wInfo = this.world.update(sdt, this.camera, this.fm.pos);
    this.fx.update(sdt, this.fm, this.camera, wInfo);
    this.audio.update(this.fm, { cockpit: this.rig.mode === 'cockpit', cloud: wInfo.inCloud > 0.2, duck: this.state === 'title' ? 0.4 : 1 });
    if (this.state === 'play' || this.state === 'complete' || this.state === 'crash') this.hud.update(dt, this);
    this.renderer.render(this.scene, this.camera);
    inp.endFrame();
  }

  loop = (now) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.manual) {
      this.frame(dt);
      requestAnimationFrame(this.loop);
    }
  };

  // ---------------------------------------------------------------- test API
  testApi() {
    const g = this;
    return {
      game: g,
      manual(on) { g.manual = on; if (!on) { g.last = performance.now(); requestAnimationFrame(g.loop); } },
      advance(frames, dt = 1 / 30) { for (let i = 0; i < frames; i++) g.frame(dt); },
      // simulate without rendering (fast)
      simulate(seconds, dt = 1 / 30) {
        const r = g.renderer.render; g.renderer.render = () => {};
        try { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) g.frame(dt); } finally { g.renderer.render = r; }
      },
      start(id) { const m = id === 'free' ? null : MISSIONS.find((x) => x.id === id); if (m) g.startMission(m); else g.startFree(); },
      setInput(o) { g.input.override = o ? { pitch: 0, roll: 0, yaw: 0, throttleAxis: 0, brake: false, throttleSet: null, ...o } : null; },
      ap: g.autopilot,
      press(code) { g.input.pressed.add(code); },
      state() {
        const fm = g.fm; const att = fm.attitude();
        return {
          state: g.state, screen: g.screen, step: g.stepIndex, mission: g.mission && g.mission.id,
          x: fm.pos.x, y: fm.pos.y, z: fm.pos.z, speedKmh: fm.speed * 3.6, vs: fm.vel.y, agl: fm.agl,
          onGround: fm.onGround, crashed: fm.crashed, crashReason: fm.crashReason, throttle: fm.throttle,
          pitch: att.pitch * 57.3, bank: att.bank * 57.3, heading: att.heading * 57.3, stall: fm.stall,
          stoppedOn: g.stoppedOn, discovered: [...g.discovered], crystals: [...g.crystalsFound], landing: fm.lastTouch,
          groundSpeed: fm.groundSpeed, surface: fm.surface, ground: g.groundAt(fm.pos.x, fm.pos.z),
        };
      },
      teleport(x, y, z, headingDeg, speed) { g.fm.placeInAir(new THREE.Vector3(x, y, z), headingDeg * Math.PI / 180, speed); g.rig.reset(g.fm); },
      resetSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} },
    };
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  $('load-text').textContent = '起動に失敗しました: ' + e.message;
});
