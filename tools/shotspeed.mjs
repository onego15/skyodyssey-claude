import { openGame } from './browser.mjs';
const { browser, page } = await openGame({ query: 'capture=1', width: 854, height: 480 });
await page.evaluate(() => { __sky.start('m1'); __sky.simulate(1); });
for (let i = 0; i < 3; i++) {
  let t = Date.now(); await page.evaluate(() => __sky.advance(1, 1 / 15)); const a = Date.now() - t;
  t = Date.now(); await page.screenshot({ path: '/tmp/claude-0/-home-user-skyodyssey-claude/62761615-203f-50e3-888b-19a42ec2492b/scratchpad/sp.jpg', type: 'jpeg', quality: 85, timeout: 120000 }); console.log('advance', a, 'shot', Date.now() - t);
}
await browser.close();
