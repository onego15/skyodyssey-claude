// Shared helper: launch headless Chromium with WebGL (SwiftShader) and open the game.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

export async function openGame({ width = 1280, height = 720, query = '', url = 'http://localhost:8080/index.html' } = {}) {
  const browser = await pw.chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(url + (query ? '?' + query : ''));
  await page.waitForFunction(() => window.__skyReady === true || /失敗/.test(document.getElementById('load-text')?.textContent || ''), null, { timeout: 180000 });
  return { browser, page, errors };
}
