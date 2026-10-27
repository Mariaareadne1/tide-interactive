// Filmstrip of the sea taking a line: node scripts/strip.mjs [z] [seconds]
// Draws a heart at (1.5, z), then shoots a frame and reads the groove depth every second.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { heart } from './shapes.mjs';

const z0 = Number(process.argv[2] ?? 1.5), secs = Number(process.argv[3] ?? 16);
mkdirSync('artifacts/strip', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5388/');
await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading);
await page.evaluate(() => { window.__tide.store.set({ uiHidden: true }); window.__tide.engine.adaptive = false; });
const toScreen = (x, z) => page.evaluate(([x, z]) => {
  const t = window.__tide, p = t.engine.camera.position.clone().set(x, t.app.heightAt(x, z), z).project(t.engine.camera);
  return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
}, [x, z]);
// wait for a wave to draw back, so the heart is drawn on bare sand
await page.waitForFunction(() => { const t = window.__tide; return t.app.cove.waves.tau(t.engine.elapsed) > 0.92; }, null, { timeout: 20000 });
const st = heart(1.2)[0];
const pts = [];
for (const [x, z] of st) pts.push(await toScreen(1.5 + x, z0 + z));
await page.mouse.move(...pts[0]);
await page.mouse.down();
for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1]);
await page.mouse.up();
const [cx, cy] = await toScreen(1.5, z0);
const files = [];
for (let i = 0; i < secs; i++) {
  const f = `artifacts/strip/f${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: f, clip: { x: cx - 220, y: cy - 120, width: 440, height: 240 } });
  files.push(f);
  const info = await page.evaluate((z0) => {
    const t = window.__tide, app = t.app, line = app.lines[app.lines.length - 1];
    const samples = line ? line.points.filter((_, k) => k % 8 === 0) : [];
    const read = app.cove.sand.read(t.engine.renderer, samples);
    const w = app.cove.waves.at(t.engine.elapsed);
    return { t: t.engine.elapsed.toFixed(1), wave: w && `${w.index}${w.big ? '*' : ''} reach ${w.reach.toFixed(1)} tau ${app.cove.waves.tau(t.engine.elapsed).toFixed(2)}`,
      depth: (read.reduce((a, r) => a + r.depth, 0) / Math.max(1, read.length)).toFixed(3), cpu: line ? (line.points.reduce((a, p) => a + p.s, 0) / line.points.length).toFixed(3) : '-', z0 };
  }, z0);
  console.log(i, JSON.stringify(info));
  await page.waitForTimeout(1000);
}
execFileSync('node', ['scripts/sheet.mjs', 'artifacts/strip-sheet.png', ...files]);
await browser.close();
