// Automated play-test: drives each mission with the test autopilot (keyboard-equivalent inputs)
import { openGame } from './browser.mjs';
const which = process.argv[2] || 'm1';
const { browser, page, errors } = await openGame({ query: 'capture=1', width: 480, height: 270 });
const st = () => page.evaluate(() => __sky.state());
const fmt = (s) => `step=${s.step} ${s.state} pos=(${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)}) v=${s.speedKmh.toFixed(0)} vs=${s.vs.toFixed(1)} agl=${(s.agl??0).toFixed(0)} p=${s.pitch.toFixed(1)} b=${s.bank.toFixed(1)} h=${s.heading.toFixed(0)} thr=${s.throttle.toFixed(2)} g=${s.onGround} ${s.crashed ? 'CRASH ' + s.crashReason : ''} stop=${s.stoppedOn}`;
async function run(plan) {
  for (const seg of plan) {
    await page.evaluate(seg.cmd);
    const t0 = Date.now();
    for (let k = 0; k < (seg.max || 120); k++) {
      await page.evaluate(() => __sky.simulate(2));
      const s = await st();
      if (k % 3 === 0) console.log(seg.name, fmt(s));
      if (s.crashed || s.state === 'crash') { console.log('CRASHED', fmt(s)); return false; }
      if (await page.evaluate(seg.until)) { console.log('done', seg.name, fmt(s)); break; }
    }
  }
  return true;
}
await page.evaluate(() => { __sky.resetSave(); });
const plans = {
  m1: [
    { name: 'takeoff', cmd: () => { __sky.start('m1'); __sky.ap.takeoff(); }, until: () => __sky.ap.mode === 'idle' },
    { name: 'cruise', cmd: () => __sky.ap.fly({ x: 1500, z: -1600, alt: 260, speed: 52 }), until: () => __sky.state().discovered.includes('lighthouse') || Math.hypot(__sky.state().x - 1500, __sky.state().z + 1600) < 400 },
    { name: 'land', cmd: () => __sky.ap.land('lighthouse'), until: () => __sky.game.state !== 'play', max: 200 },
  ],
  m2: [
    { name: 'takeoff', cmd: () => { __sky.start('m2'); __sky.ap.takeoff(); }, until: () => __sky.ap.mode === 'idle' },
    { name: 'to-canyon', cmd: () => __sky.ap.fly({ x: -1900, z: -6200, alt: 250, speed: 52 }), until: () => Math.hypot(__sky.state().x + 1900, __sky.state().z + 6200) < 500 },
    { name: 'canyon1', cmd: () => __sky.ap.fly({ x: -2150, z: -8350, alt: 300, speed: 48 }), until: () => Math.hypot(__sky.state().x + 2150, __sky.state().z + 8350) < 400 },
    { name: 'canyon2', cmd: () => __sky.ap.fly({ x: -2600, z: -10300, alt: 480, speed: 48 }), until: () => Math.hypot(__sky.state().x + 2600, __sky.state().z + 10300) < 400 },
    { name: 'ruins', cmd: () => __sky.ap.fly({ x: -3100, z: -12300, alt: 520, speed: 46 }), until: () => __sky.state().discovered.includes('ruins') },
    { name: 'pass', cmd: () => __sky.ap.fly({ x: -3150, z: -12700, alt: 480, speed: 46 }), until: () => __sky.state().z < -12500 },
    { name: 'turn', cmd: () => __sky.ap.fly({ heading: 160, alt: 520, speed: 44, maxBank: 0.8 }), until: () => Math.abs(__sky.state().heading - 165) < 25 },
    { name: 'out1', cmd: () => __sky.ap.fly({ x: -2950, z: -11300, alt: 520, speed: 48 }), until: () => Math.hypot(__sky.state().x + 2950, __sky.state().z + 11300) < 400 },
    { name: 'out2', cmd: () => __sky.ap.fly({ x: -2350, z: -9300, alt: 450, speed: 50 }), until: () => Math.hypot(__sky.state().x + 2350, __sky.state().z + 9300) < 400 },
    { name: 'land', cmd: () => __sky.ap.land('foothill'), until: () => __sky.game.state !== 'play', max: 250 },
  ],
  m3: [
    { name: 'takeoff', cmd: () => { __sky.start('m3'); __sky.ap.takeoff(); }, until: () => __sky.ap.mode === 'idle' },
    { name: 'east', cmd: () => __sky.ap.fly({ x: 4000, z: -13500, alt: 450, speed: 55 }), until: () => __sky.game.stepIndex >= 1 },
    { name: 'island', cmd: () => __sky.ap.fly({ x: 7500, z: -15500, alt: 480, speed: 52 }), until: () => __sky.game.stepIndex >= 2 },
    { name: 'land', cmd: () => __sky.ap.land('secret'), until: () => __sky.game.state !== 'play', max: 300 },
  ],
};
const ok = await run(plans[which]);
const s = await st();
console.log('RESULT', which, ok, fmt(s), JSON.stringify(s.landing), 'discovered', s.discovered.join(','));
console.log(errors.filter((e) => !e.includes('non-indexed')).slice(0, 10).join('\n'));
await browser.close();
