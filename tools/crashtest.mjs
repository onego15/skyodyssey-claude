// Crash & retry test plus HUD screenshots (full page incl. DOM overlay)
import { openGame } from './browser.mjs';
const out = process.argv[2];
const { browser, page, errors } = await openGame({ query: 'capture=1', width: 1280, height: 720 });
const st = () => page.evaluate(() => __sky.state());
await page.evaluate(() => { __sky.resetSave(); __sky.start('m1'); __sky.simulate(1.5); });
await page.evaluate(() => __sky.advance(1));
await page.screenshot({ path: out + '/hud-start.png', timeout: 120000 });
// manual takeoff with key-equivalent override
await page.evaluate(() => { __sky.setInput({ throttleSet: 1 }); __sky.simulate(14); __sky.setInput({ throttleSet: 1, pitch: 0.6 }); __sky.simulate(2.5); __sky.setInput({ throttleSet: 0.85 }); __sky.simulate(10); });
console.log('after takeoff', JSON.stringify(await st()));
await page.evaluate(() => __sky.advance(1));
await page.screenshot({ path: out + '/hud-air.png', timeout: 120000 });
// dive into the sea
await page.evaluate(() => { __sky.setInput({ throttleSet: 1, pitch: -1 }); __sky.simulate(15); });
let s = await st(); console.log('dive', s.state, s.crashed, s.crashReason);
await page.evaluate(() => __sky.advance(1));
await page.screenshot({ path: out + '/crash.png', timeout: 120000 });
// retry from checkpoint via Enter
await page.evaluate(() => { __sky.setInput(null); __sky.press('Enter'); __sky.simulate(0.1); });
s = await st(); console.log('retry', s.state, s.crashed, 'step', s.step, 'y', s.y.toFixed(0), 'v', s.speedKmh.toFixed(0));
await page.evaluate(() => { __sky.setInput({ throttleSet: 0.7 }); __sky.simulate(5); });
s = await st(); console.log('after retry flying', s.state, s.crashed, 'y', s.y.toFixed(0), 'v', s.speedKmh.toFixed(0));
// crash again and restart mission from scratch
await page.evaluate(() => { __sky.setInput({ throttleSet: 1, pitch: -1 }); __sky.simulate(20); });
s = await st(); console.log('crash2', s.state, s.crashReason);
await page.evaluate(() => { __sky.setInput(null); __sky.press('Backspace'); __sky.simulate(0.1); });
s = await st(); console.log('restart', s.state, 'step', s.step, 'onGround', s.onGround, 'v', s.speedKmh.toFixed(0));
// terrain collision: fly into a hill on home island
await page.evaluate(() => { __sky.teleport(-900, 60, -300, 270, 45); __sky.setInput({ throttleSet: 0.8 }); __sky.simulate(25); });
s = await st(); console.log('hill', s.state, s.crashReason, 'ground', s.ground.toFixed(1));
// collider: fly into the lighthouse tower
await page.evaluate(() => { __sky.press('Enter'); __sky.simulate(0.1); __sky.teleport(2780 - 600, 100, -3560, 90, 45); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(18); });
s = await st(); console.log('lighthouse', s.state, s.crashReason);
// pause & map
await page.evaluate(() => { __sky.press('Enter'); __sky.simulate(0.1); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(1); __sky.press('KeyM'); __sky.advance(1); });
await page.screenshot({ path: out + '/map.png', timeout: 120000 });
s = await st(); console.log('map', s.state);
await page.evaluate(() => { __sky.press('KeyM'); __sky.advance(1); __sky.press('Escape'); __sky.advance(1); });
s = await st(); console.log('pause', s.state);
await page.screenshot({ path: out + '/pause.png', timeout: 120000 });
console.log(errors.filter((e) => !e.includes('non-indexed')).slice(0, 10).join('\n'));
await browser.close();
