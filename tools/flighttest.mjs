import { openGame } from './browser.mjs';
const { browser, page, errors } = await openGame({ query: 'capture=1', width: 640, height: 360 });
const st = () => page.evaluate(() => __sky.state());
const fmt = (s) => `t step=${s.step} st=${s.state} pos=(${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)}) v=${s.speedKmh.toFixed(0)} vs=${s.vs.toFixed(1)} agl=${(s.agl??0).toFixed(0)} p=${s.pitch.toFixed(1)} b=${s.bank.toFixed(1)} h=${s.heading.toFixed(0)} thr=${s.throttle.toFixed(2)} g=${s.onGround} crash=${s.crashed} ${s.crashReason||''} stop=${s.stoppedOn}`;
await page.evaluate(() => { __sky.resetSave(); __sky.start('m1'); });
// manual-ish takeoff with input override: full throttle
await page.evaluate(() => __sky.setInput({ throttleSet: 1 }));
for (let i = 0; i < 12; i++) { await page.evaluate(() => __sky.simulate(2)); console.log(fmt(await st())); const s = await st(); if (s.speedKmh > 110) break; }
await page.evaluate(() => __sky.setInput({ throttleSet: 1, pitch: 0.7 }));
for (let i = 0; i < 6; i++) { await page.evaluate(() => __sky.simulate(1)); console.log(fmt(await st())); }
await page.evaluate(() => __sky.setInput({ throttleSet: 0.9, pitch: 0 }));
for (let i = 0; i < 5; i++) { await page.evaluate(() => __sky.simulate(2)); console.log(fmt(await st())); }
// bank right test
await page.evaluate(() => __sky.setInput({ throttleSet: 0.8, roll: 0.6 }));
await page.evaluate(() => __sky.simulate(1)); console.log('roll', fmt(await st()));
await page.evaluate(() => __sky.setInput({ throttleSet: 0.8, roll: 0 }));
for (let i = 0; i < 4; i++) { await page.evaluate(() => __sky.simulate(2)); console.log('turn', fmt(await st())); }
console.log(errors.slice(0, 10).join('\n'));
await browser.close();
