// Records real gameplay frames deterministically (fixed time step) in headless
// Chromium and writes them as numbered JPEGs. The aircraft is flown by the
// test autopilot, which feeds the same input channels as the keyboard.
// Usage: node tools/record.mjs <outDir> <gif|long> [fps]
import { openGame } from './browser.mjs';
import fs from 'fs';

const out = process.argv[2];
const plan = process.argv[3] || 'gif';
const fps = +(process.argv[4] || 15);
fs.mkdirSync(out, { recursive: true });
const { browser, page, errors } = await openGame({ query: 'capture=1', width: 854, height: 480 });
let frame = 0;
const dt = 1 / fps;

async function record(seconds, label) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate((d) => __sky.advance(1, d), dt);
    await page.screenshot({ path: `${out}/f${String(frame).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88, timeout: 180000 });
    frame++;
  }
  const s = await page.evaluate(() => __sky.state());
  console.log(`rec ${label} ${seconds}s -> frame ${frame} | ${s.state} v=${s.speedKmh.toFixed(0)} y=${s.y.toFixed(0)} step=${s.step} crashed=${s.crashed}`);
}
// simulate (no rendering) until a condition holds
async function until(cond, maxSec = 600, chunk = 0.25) {
  for (let t = 0; t < maxSec; t += chunk) {
    if (await page.evaluate(cond)) return true;
    await page.evaluate((c) => __sky.simulate(c), chunk);
  }
  console.log('until: timed out', cond.toString());
  return false;
}
const ev = (fn, arg) => page.evaluate(fn, arg);
const near = (x, z, r) => new Function(`const s = __sky.state(); return Math.hypot(s.x - (${x}), s.z - (${z})) < ${r};`);

await ev(() => { __sky.resetSave(); });

async function takeoffSegment(full) {
  await ev(() => { __sky.start('m1'); __sky.simulate(0.4); });
  await ev(() => __sky.ap.takeoff());
  if (full) await record(12, 'takeoff-full');
  else {
    await record(1.2, 'runup');
    await until(() => __sky.state().speedKmh > 100);
  }
  await record(full ? 6 : 4.2, 'liftoff');
}
async function cruiseSegment(sec) {
  await until(() => __sky.ap.mode === 'idle', 60);
  await ev(() => __sky.ap.fly({ x: 1500, z: -1600, alt: 230, speed: 52 }));
  await until(() => __sky.state().y > 170, 60);
  await record(sec, 'cruise');
}
async function landingSegment(sec) {
  await until(near(1500, -1600, 450), 200);
  await ev(() => __sky.ap.land('lighthouse'));
  // start recording on short final
  await until(() => { const s = __sky.state(); return s.y - 22 < 34 && Math.hypot(s.x - 2670, s.z + 3010) < 900; }, 300, 0.1);
  await record(sec, 'landing');
}
async function ruinsSegment(sec) {
  await ev(() => { __sky.start('m2'); __sky.ap.takeoff(); });
  await until(() => __sky.ap.mode === 'idle', 60);
  const legs = [[-1900, -6200, 250], [-2150, -8350, 300], [-2600, -10300, 480]];
  for (const [x, z, alt] of legs) {
    await ev((a) => __sky.ap.fly({ x: a[0], z: a[1], alt: a[2], speed: 50 }), [x, z, alt]);
    await until(near(x, z, 400), 400);
  }
  await ev(() => __sky.ap.fly({ x: -3100, z: -12300, alt: 520, speed: 46 }));
  await until(() => { const s = __sky.state(); return Math.hypot(s.x + 3150, s.z + 12500) < 820; }, 200, 0.1);
  await record(sec, 'ruins');
}
async function canyonSegment(sec) {
  await ev(() => { __sky.start('m2'); __sky.teleport(-1980, 230, -7300, 352, 47); __sky.ap.fly({ x: -2150, z: -8350, alt: 240, speed: 47 }); __sky.simulate(1); });
  await record(sec, 'canyon');
}
async function phantomSegment(sec) {
  await ev(() => { __sky.start('m3'); __sky.ap.takeoff(); });
  await until(() => __sky.ap.mode === 'idle', 60);
  await ev(() => __sky.ap.fly({ x: 4000, z: -13500, alt: 450, speed: 55 }));
  await until(() => __sky.game.stepIndex >= 1, 400);
  await ev(() => __sky.ap.fly({ x: 7500, z: -15500, alt: 480, speed: 52 }));
  await until(() => __sky.game.stepIndex >= 2, 400);
  await ev(() => __sky.ap.land('secret'));
  await until(() => { const s = __sky.state(); return Math.hypot(s.x - 7500, s.z + 15500) < 1500 && s.y < 200; }, 400, 0.1);
  await record(sec, 'secret-landing');
}

if (plan === 'gif') {
  await takeoffSegment(false);
  await cruiseSegment(2.0);
  await landingSegment(4.0);
  await ruinsSegment(3.2);
} else {
  await takeoffSegment(true);
  await cruiseSegment(5);
  await landingSegment(12);
  await canyonSegment(6);
  await ruinsSegment(6);
  await phantomSegment(12);
}
console.log('frames', frame);
console.log(errors.filter((e) => !e.includes('non-indexed')).slice(0, 10).join('\n'));
await browser.close();
