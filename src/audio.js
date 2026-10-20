// Fully synthesized audio (Web Audio API): engine, wind, tyres, effects and a
// generative adventure soundtrack. No audio files are needed.
import { clamp, mulberry32 } from './noise.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.musicVol = 0.5;
    this.sfxVol = 0.8;
    this.mood = 'dawn';
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicVol * 0.55; this.music.connect(this.master);
    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.55;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.buildEngine();
    this.buildWind();
    this.enabled = true;
    this.musicStart();
  }

  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeNoise(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 4; }
    return buf;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    return s;
  }

  buildEngine() {
    const ctx = this.ctx;
    this.eng = {};
    const e = this.eng;
    e.out = ctx.createGain(); e.out.gain.value = 0;
    e.filter = ctx.createBiquadFilter(); e.filter.type = 'lowpass'; e.filter.frequency.value = 600; e.filter.Q.value = 1.2;
    e.o1 = ctx.createOscillator(); e.o1.type = 'sawtooth';
    e.o2 = ctx.createOscillator(); e.o2.type = 'square';
    e.o3 = ctx.createOscillator(); e.o3.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.28;
    const g2 = ctx.createGain(); g2.gain.value = 0.12;
    const g3 = ctx.createGain(); g3.gain.value = 0.45;
    e.o1.connect(g1); e.o2.connect(g2); e.o3.connect(g3);
    g1.connect(e.filter); g2.connect(e.filter); g3.connect(e.filter);
    // propeller "thrum": amplitude modulation
    e.am = ctx.createGain(); e.am.gain.value = 0.7;
    e.lfo = ctx.createOscillator(); e.lfo.type = 'sine';
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.3;
    e.lfo.connect(lfoGain); lfoGain.connect(e.am.gain);
    e.filter.connect(e.am); e.am.connect(e.out);
    // combustion noise
    e.n = this.noiseSrc();
    e.nf = ctx.createBiquadFilter(); e.nf.type = 'bandpass'; e.nf.frequency.value = 300; e.nf.Q.value = 0.8;
    e.ng = ctx.createGain(); e.ng.gain.value = 0.15;
    e.n.connect(e.nf); e.nf.connect(e.ng); e.ng.connect(e.am);
    e.out.connect(this.sfx);
    for (const o of [e.o1, e.o2, e.o3, e.lfo, e.n]) o.start();
    // tyre rumble
    this.roll = { src: this.noiseSrc(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.roll.f.type = 'lowpass'; this.roll.f.frequency.value = 220;
    this.roll.g.gain.value = 0;
    this.roll.src.connect(this.roll.f); this.roll.f.connect(this.roll.g); this.roll.g.connect(this.sfx);
    this.roll.src.start();
    // stall warning
    this.stallOsc = ctx.createOscillator(); this.stallOsc.type = 'square'; this.stallOsc.frequency.value = 880;
    this.stallG = ctx.createGain(); this.stallG.gain.value = 0;
    this.stallOsc.connect(this.stallG); this.stallG.connect(this.sfx); this.stallOsc.start();
  }

  buildWind() {
    const ctx = this.ctx;
    this.wind = { src: this.noiseSrc(), f: ctx.createBiquadFilter(), f2: ctx.createBiquadFilter(), g: ctx.createGain() };
    const w = this.wind;
    w.f.type = 'bandpass'; w.f.frequency.value = 500; w.f.Q.value = 0.6;
    w.f2.type = 'highshelf'; w.f2.frequency.value = 2000; w.f2.gain.value = -6;
    w.g.gain.value = 0;
    w.src.connect(w.f); w.f.connect(w.f2); w.f2.connect(w.g); w.g.connect(this.sfx);
    w.src.start();
  }

  // Called every frame with flight state
  update(fm, opts = {}) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const e = this.eng;
    const rpm = fm.crashed ? 0 : fm.rpm;
    const base = 38 + rpm * 62 + fm.speed * 0.15;
    const sm = 0.08;
    e.o1.frequency.setTargetAtTime(base, t, sm);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, sm);
    e.o3.frequency.setTargetAtTime(base * 0.25, t, sm);
    e.lfo.frequency.setTargetAtTime(base * 0.34, t, sm);
    e.filter.frequency.setTargetAtTime(380 + rpm * 1500, t, sm);
    e.nf.frequency.setTargetAtTime(200 + rpm * 500, t, sm);
    const inside = opts.cockpit ? 1.25 : 1;
    e.out.gain.setTargetAtTime(fm.crashed ? 0 : (0.1 + rpm * 0.2) * inside * (opts.duck ?? 1), t, 0.1);
    const sp = fm.speed;
    const windAmt = clamp((sp - 8) / 70, 0, 1.3);
    this.wind.g.gain.setTargetAtTime(windAmt * windAmt * 0.32 * (opts.cloud ? 1.6 : 1) + (fm.stall ? 0.08 : 0), t, 0.15);
    this.wind.f.frequency.setTargetAtTime(300 + sp * 14 + Math.abs(fm.omega.x) * 400, t, 0.15);
    const rolling = fm.onGround && !fm.crashed ? clamp(sp / 30, 0, 1) : 0;
    this.roll.g.gain.setTargetAtTime(rolling * (fm.surface === 'asphalt' ? 0.12 : 0.25), t, 0.05);
    const beep = fm.stall && Math.floor(t * 5) % 2 === 0 ? 0.05 : 0;
    this.stallG.gain.setTargetAtTime(beep, t, 0.01);
  }

  oneShotNoise(dur, freq, q, gain, type = 'bandpass') {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noiseSrc();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  thump(freq = 70, gain = 0.6, dur = 0.35) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.8, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  touchdown(strength) {
    this.thump(60, 0.35 + strength * 0.4, 0.4);
    this.oneShotNoise(0.35 + strength * 0.3, 2600, 3, 0.25 + strength * 0.25);
    this.oneShotNoise(0.2, 900, 1, 0.2);
  }

  crash() {
    this.thump(40, 1, 1.2);
    this.oneShotNoise(1.8, 400, 0.5, 0.9, 'lowpass');
    this.oneShotNoise(0.6, 1800, 1, 0.4);
  }

  splash() { this.oneShotNoise(1.5, 900, 0.6, 0.8); this.thump(50, 0.6, 0.8); }

  bell(notes, gap = 0.16, vol = 0.3) {
    if (!this.enabled) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    notes.forEach((n, i) => {
      const t = t0 + i * gap;
      for (const [mult, amp] of [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(n) * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * amp, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 2.4 / mult);
        o.connect(g); g.connect(this.sfx); g.connect(this.reverb);
        o.start(t); o.stop(t + 2.6);
      }
    });
  }

  discovery() { this.bell([74, 78, 81, 86, 90], 0.14, 0.22); this.swell(); }
  crystal() { this.bell([86, 90, 93, 98], 0.06, 0.16); }
  objective() { this.bell([79, 83, 86], 0.12, 0.18); }
  success() { this.bell([74, 78, 81, 86, 81, 86, 90], 0.15, 0.22); }
  ui() { this.bell([88], 0.05, 0.08); }

  swell() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const n of [50, 57, 62, 66, 69]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0005, t + 5);
      o.connect(f); f.connect(g); g.connect(this.music); g.connect(this.reverb);
      o.start(t); o.stop(t + 5.2);
    }
  }

  // ---------------- generative music ----------------
  setMood(m) { this.mood = m; }

  musicStart() {
    this.rnd = mulberry32(2024);
    this.beat = 0;
    this.nextTime = this.ctx.currentTime + 0.5;
    this.musicTimer = setInterval(() => this.schedule(), 100);
  }

  schedule() {
    const ctx = this.ctx;
    const PROG = {
      dawn: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 69]], // D maj7, Bm7, Gmaj7, A
      day: [[60, 64, 67, 71], [57, 60, 64, 67], [65, 69, 72, 76], [62, 65, 69, 72]], // C maj7, Am7, Fmaj7, Dm7
      sunset: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67], [52, 56, 59, 64]], // Am7, Fmaj7, G, E
      title: [[62, 66, 69, 73], [55, 59, 62, 66], [59, 62, 66, 69], [57, 61, 64, 69]],
    };
    const prog = PROG[this.mood] || PROG.dawn;
    const spb = 60 / 76 / 2; // eighth notes at 76 bpm
    while (this.nextTime < ctx.currentTime + 0.4) {
      const t = this.nextTime;
      const bar = Math.floor(this.beat / 16);
      const chord = prog[bar % prog.length];
      const step = this.beat % 16;
      if (step === 0) this.pad(chord, t, spb * 16);
      if (step === 0 || step === 8) this.bass(chord[0] - 24, t, spb * 8);
      // harp-like arpeggio
      const pat = [0, 1, 2, 3, 2, 1, 2, 3];
      if (this.rnd() < 0.85) this.pluck(chord[pat[step % 8]] + (step >= 8 ? 12 : 0), t, 0.05 + 0.03 * this.rnd());
      // occasional melody
      if ((step === 4 || step === 12 || step === 0) && this.rnd() < 0.45) {
        const scale = chord.map((n) => n + 12);
        const n = scale[Math.floor(this.rnd() * scale.length)] + (this.rnd() < 0.3 ? 2 : 0);
        this.flute(n, t, spb * (2 + Math.floor(this.rnd() * 4)));
      }
      this.nextTime += spb;
      this.beat++;
    }
  }

  pad(chord, t, dur) {
    const ctx = this.ctx;
    for (const n of chord) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n - 12); o.detune.value = det;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.018, t + dur * 0.3);
        g.gain.linearRampToValueAtTime(0.0, t + dur + 0.6);
        o.connect(f); f.connect(g); g.connect(this.music); g.connect(this.reverb);
        o.start(t); o.stop(t + dur + 0.7);
      }
    }
  }

  bass(n, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pluck(n, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(n);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = NOTE(n) * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.4);
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.music); g.connect(this.reverb);
    o.start(t); o2.start(t); o.stop(t + 1.5); o2.stop(t + 1.5);
  }

  flute(n, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(n);
    const vib = ctx.createOscillator(); vib.frequency.value = 5;
    const vg = ctx.createGain(); vg.gain.value = 3;
    vib.connect(vg); vg.connect(o.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.12);
    g.gain.setValueAtTime(0.05, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.music); g.connect(this.reverb);
    o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.music.gain.value = music * 0.55;
    this.sfx.gain.value = sfx;
  }
}
