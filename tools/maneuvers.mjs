// Checks climb / descent / turn / auto-level / stall / no-rotation behaviour with keyboard-equivalent inputs.
import { openGame } from './browser.mjs';
const { browser, page } = await openGame({ query: 'capture=1', width: 320, height: 180 });
const st = () => page.evaluate(() => __sky.state());
const show = (l, s) => console.log(l.padEnd(26), `v=${s.speedKmh.toFixed(0)}km/h alt=${s.y.toFixed(0)} vs=${s.vs.toFixed(1)} pitch=${s.pitch.toFixed(1)} bank=${s.bank.toFixed(1)} hdg=${s.heading.toFixed(0)} ground=${s.onGround} crashed=${s.crashed}`);
// 1. no rotation: full throttle, no pitch input, 20s
await page.evaluate(() => { __sky.resetSave(); __sky.start('m1'); __sky.setInput({ throttleSet: 1 }); __sky.simulate(17); });
show('full power, no pitch 17s', await st());
// 2. low speed pitch-up attempt: throttle 0.5 for 6s then pull
await page.evaluate(() => { __sky.start('m1'); __sky.setInput({ throttleSet: 1 }); __sky.simulate(6); __sky.setInput({ throttleSet: 1, pitch: 1 }); __sky.simulate(2); });
show('pull at ~60km/h (2s)', await st());
await page.evaluate(() => { __sky.teleport(0, 600, 3000, 0, 50); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(4); });
show('level cruise', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 1, pitch: 0.6 }); __sky.simulate(3); });
show('climb (S held 3s)', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 1 }); __sky.simulate(8); });
show('released 8s', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 0.4, pitch: -0.5 }); __sky.simulate(3); });
show('descend (W held 3s)', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(8); });
show('released 8s', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 0.7, roll: 1 }); __sky.simulate(10); });
show('D held 10s (right turn)', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 0.7 }); __sky.simulate(4); });
show('released 4s', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 0.7, roll: -1 }); __sky.simulate(5); });
show('A held 5s (left turn)', await st());
await page.evaluate(() => { __sky.setInput({ throttleSet: 0, pitch: 1 }); __sky.simulate(8); });
const s = await st(); show('idle + full pull 8s', s); console.log('stall flag', s.stall);
await page.evaluate(() => { __sky.setInput({ throttleSet: 1 }); __sky.simulate(10); });
show('recover (release, full)', await st());
await browser.close();
