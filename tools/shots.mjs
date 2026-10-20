// Render screenshots of given scenes to inspect visuals.
import { openGame } from './browser.mjs';
import fs from 'fs';
const out = process.argv[2];
const which = (process.argv[3] || 'all').split(',');
const { browser, page, errors } = await openGame({ query: 'capture=1', width: 960, height: 540 });
async function snap(name) {
  const t0 = Date.now();
  const data = await page.evaluate(() => { __sky.advance(1, 1 / 30); return document.querySelector('#app canvas').toDataURL('image/jpeg', 0.85); });
  fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(name, Date.now() - t0, 'ms');
}
const scenes = {
  title: async () => { await page.evaluate(() => { __sky.simulate(1); }); },
  m1start: async () => { await page.evaluate(() => { __sky.start('m1'); __sky.simulate(2.00); }); },
  m1air: async () => { await page.evaluate(() => { __sky.start('m1'); __sky.teleport(600, 220, -900, 45, 50); __sky.setInput({ throttleSet: 0.7 }); __sky.simulate(1.33); }); },
  arch: async () => { await page.evaluate(() => { __sky.start('m1'); __sky.teleport(1100, 60, -1000, 40, 45); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(1.00); }); },
  lighthouse: async () => { await page.evaluate(() => { __sky.start('m1'); __sky.teleport(2000, 140, -2600, 50, 45); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(1.00); }); },
  cloudsea: async () => { await page.evaluate(() => { __sky.start('m2'); __sky.teleport(-500, 800, -7600, 330, 50); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(1.00); }); },
  canyon: async () => { await page.evaluate(() => { __sky.start('m2'); __sky.teleport(-2050, 230, -7800, 350, 45); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(1.00); }); },
  ruins: async () => { await page.evaluate(() => { __sky.start('m2'); __sky.teleport(-3000, 480, -11500, 345, 45); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(2.00); }); },
  peak: async () => { await page.evaluate(() => { __sky.start('m2'); __sky.teleport(200, 1400, -11500, 300, 50); __sky.setInput({ throttleSet: 0.7 }); __sky.simulate(1.00); }); },
  sunset: async () => { await page.evaluate(() => { __sky.start('m3'); __sky.teleport(1500, 450, -9000, 60, 50); __sky.setInput({ throttleSet: 0.7 }); __sky.simulate(1.00); }); },
  phantom: async () => { await page.evaluate(() => { __sky.start('m3'); __sky.teleport(5600, 380, -14900, 110, 50); __sky.setInput({ throttleSet: 0.6 }); __sky.simulate(1.00); }); },
  caldera: async () => { await page.evaluate(() => { __sky.start('m3'); __sky.teleport(6800, 200, -15250, 110, 45); __sky.setInput({ throttleSet: 0.5 }); __sky.simulate(1.00); }); },
};
for (const k of Object.keys(scenes)) {
  if (!which.includes('all') && !which.includes(k)) continue;
  await scenes[k]();
  await snap(k);
}
console.log(errors.filter((e) => !e.includes('non-indexed')).slice(0, 10).join('\n'));
await browser.close();
