import { openGame } from './browser.mjs';
const out = process.argv[2];
const { browser, page } = await openGame({ query: 'capture=1', width: 854, height: 480 });
await page.evaluate(() => { __sky.resetSave(); __sky.start('m1'); __sky.teleport(1500, 250, -1600, 50, 50); __sky.game.stepIndex = 3; __sky.game.hud.setMission(__sky.game.mission, 3); __sky.ap.land('lighthouse'); });
for (let i = 0; i < 200; i++) { const st = await page.evaluate(() => { __sky.simulate(1); return __sky.game.state; }); if (st === 'result') break; }
await page.evaluate(() => __sky.advance(1));
await page.screenshot({ path: out + '/result.png', timeout: 120000 });
// discovery banner: fly toward the sea arch
await page.evaluate(() => { __sky.start('m1'); __sky.teleport(1300, 120, -1150, 40, 50); __sky.setInput({ throttleSet: 0.6 }); });
for (let i = 0; i < 60; i++) { const d = await page.evaluate(() => { __sky.simulate(0.2); return __sky.state().discovered.includes('arch'); }); if (d) break; }
await page.evaluate(() => { __sky.simulate(1.2); __sky.advance(1); });
await page.screenshot({ path: out + '/discovery.png', timeout: 120000 });
await browser.close();
