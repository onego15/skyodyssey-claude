import { openGame } from './browser.mjs';
const { browser, page, errors } = await openGame({ query: 'capture=1', width: 960, height: 540 });
for (let i = 0; i < 3; i++) {
  const t = await page.evaluate(() => { const t0 = performance.now(); __sky.advance(1); __sky.game.renderer.getContext().finish(); return performance.now() - t0; });
  console.log('frame ms', t.toFixed(0));
}
const info = await page.evaluate(() => { const r = __sky.game.renderer.info; return { calls: r.render.calls, tris: r.render.triangles }; });
console.log(info);
const t0 = Date.now();
await page.screenshot({ path: process.argv[2] + '/title.png', timeout: 120000 });
console.log('shot ms', Date.now() - t0);
console.log(errors.slice(0, 20).join('\n'));
await browser.close();
