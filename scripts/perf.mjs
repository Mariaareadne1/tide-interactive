// GPU-synced frame benchmark: node scripts/perf.mjs [dpr=2]
// Renders back-to-back frames with a pixel readback after each (forces the GPU to finish),
// with a few lines in the sand, a wave running and all four crabs moving.
import { chromium } from '@playwright/test';
import { loadavg, cpus } from 'node:os';

const dpr = Number(process.argv[2] ?? 2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
await page.goto('http://localhost:5388/');
await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading, null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const t = window.__tide, e = t.engine, gl = e.renderer.getContext();
  const toS = (x, z) => { const p = e.camera.position.clone().set(x, t.app.heightAt(x, z), z).project(e.camera); return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight }; };
  for (let k = 0; k < 4; k++) {
    const a = toS(-5 + k * 2.5, 0.5);
    t.app.beginLine(a.x, a.y);
    const pts = [];
    for (let i = 0; i < 60; i++) pts.push(toS(-5 + k * 2.5 + Math.sin(i * 0.2) * 0.6, 0.5 - i * 0.03));
    t.app.extendLine(pts);
    t.app.endLine();
  }
  e.stop();
  e.adaptive = false;
  const px = new Uint8Array(4);
  const times = [];
  for (let i = 0; i < 300; i++) {
    const t0 = performance.now();
    e.tick(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    times.push(performance.now() - t0);
  }
  e.start();
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.floor(times.length * p)];
  return { median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p99: +q(0.99).toFixed(2), w: e.canvas.width, h: e.canvas.height, calls: e.renderer.info.render.calls };
});
console.log(JSON.stringify({ ...res, load: loadavg().map((l) => l.toFixed(1)).join(' '), cores: cpus().length }));
await browser.close();
