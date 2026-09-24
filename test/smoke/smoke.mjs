// Loads the real game in headless Chromium, walks to a list of viewpoints,
// takes a screenshot at each, and fails on any page error.
//
//   npm run test:smoke                       every view in views.mjs
//   node test/smoke/smoke.mjs spawn night    only these views
//   SMOKE_SAVES=test/fixtures/v2.2 SMOKE_NAME=Ann node test/smoke/smoke.mjs
//                                            play an existing save as that farmer
//
// Screenshots and a summary (fps, draw calls, triangles per view) land in
// test-output/smoke/. Uses the Chromium that ships with Playwright; nothing is
// downloaded. Prints SKIP and exits 0 if Playwright is not installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startCasino } from '../../server/app.js';
import { VIEWS } from './views.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', '..', 'test-output', 'smoke');
fs.mkdirSync(outDir, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

async function loadChromium() {
  for (const name of ['playwright-core', 'playwright']) {
    try { return (await import(name)).chromium; } catch { /* try the next */ }
  }
  const require = createRequire(import.meta.url);
  for (const dir of ['/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright']) {
    try { return require(dir).chromium; } catch { /* try the next */ }
  }
  return null;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const chromium = await loadChromium();
if (!chromium) {
  console.log('SKIP  Playwright is not installed; nothing to smoke-test with.');
  process.exit(0);
}

const wanted = process.argv.slice(2);
const views = wanted.length ? VIEWS.filter((v) => wanted.includes(v.name)) : VIEWS;
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-saves-'));
if (process.env.SMOKE_SAVES) copyDir(path.resolve(process.env.SMOKE_SAVES), saveDir);
const name = process.env.SMOKE_NAME || 'Smokey';
const port = 3900 + Math.floor(Math.random() * 90);
const casino = await startCasino({ port, saveDir });

const errors = [];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/pointer ?lock|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`);
});

const summary = [];
try {
  await page.goto(casino.localUrl);
  await page.fill('#name', name);
  await page.click('#enter');
  await page.waitForFunction(() => window.casino && window.casino.controls && window.casino.perf, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const room = casino.room;
  const me = [...room.players.values()][0];

  for (const view of views) {
    if (view.server) view.server(room, me);
    await page.evaluate((v) => {
      const c = window.casino;
      if (v.client) (0, eval)(`(${v.client})`)(c);
      if (v.pos) { c.controls.pos.set(v.pos[0], v.pos[1] || 0, v.pos[2]); c.controls.vel && c.controls.vel.set(0, 0, 0); }
      if (v.yaw != null) c.controls.yaw = v.yaw;
      if (v.pitch != null) c.controls.pitch = v.pitch;
    }, { pos: view.pos, yaw: view.yaw, pitch: view.pitch, client: view.client ? view.client.toString() : null });
    await page.waitForTimeout(view.wait || 2500);
    const file = path.join(outDir, `${view.name}.png`);
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => window.casino.perf.stats());
    summary.push({ view: view.name, ...stats });
    console.log(`shot  ${view.name.padEnd(14)} ${String(stats.calls).padStart(5)} calls  ${String(Math.round(stats.tris / 1000)).padStart(5)}k tris  ${stats.fps} fps`);
  }
} catch (err) {
  errors.push(`smoke: ${err.message}`);
} finally {
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ summary, errors }, null, 2));
  await browser.close();
  await casino.close();
  fs.rmSync(saveDir, { recursive: true, force: true });
}

for (const e of errors) console.log(`FAIL  ${e}`);
console.log(errors.length ? `${errors.length} error(s)` : `ALL PASSED  (${summary.length} views, screenshots in ${outDir})`);
process.exit(errors.length ? 1 : 0);
