// Scripted ~18 s demo, recorded by the app's own recorder (the groove is in the scene,
// so there is no ink to composite). node scripts/demo.mjs [width] [height] [url]
//   a quiet beach → a finger writes "hi" and a heart in the wet sand → a crab scuttles
//   over and walks the heart → a big wave runs up and washes the word away while the
//   crab burrows → the sand glistens, dries, and is smooth again
// -> artifacts/tide-demo.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { heart, word } from './shapes.mjs';

const [W = '1600', H = '900', URL = 'http://localhost:5388/'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading, null, { timeout: 90000 });
const sleep = (ms) => page.waitForTimeout(ms);
const toScreen = (x, z) => page.evaluate(([x, z]) => {
  const t = window.__tide, p = t.engine.camera.position.clone().set(x, t.app.heightAt(x, z), z).project(t.engine.camera);
  return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
}, [x, z]);

/** Draw strokes (world metres around cx, cz) at a finger's pace. */
async function draw(strokes, cx, cz, msPerStroke) {
  for (const st of strokes) {
    const pts = [];
    for (const [x, z] of st) pts.push(await toScreen(cx + x, cz + z));
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    for (const p of pts.slice(1)) {
      await page.mouse.move(p[0], p[1]);
      await sleep(msPerStroke / pts.length);
    }
    await page.mouse.up();
    await sleep(140);
  }
}

// a calm start: line the next big wave up with the moment the heart has been walked
await page.evaluate(() => {
  const t = window.__tide;
  t.store.set({ uiHidden: true, hasDrawn: true });
  t.engine.adaptive = false;
  t.app.cove.waves.scheduleBig(t.engine.elapsed, 11.2);
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = t.record(t.engine.canvas, { seconds: 40, until: window.__demoDone });
});
await sleep(1300); // the quiet beach
await draw(word(1.25), -2.6, 1.7, 700); // "hi" low on the wet sand
await draw(heart(1.05), 0.6, 0.95, 1300); // a heart a little higher
await sleep(200);
// the crab that comes to walk the heart will dig in when the big wave comes
const walker = await page.evaluate(() => {
  const t = window.__tide, heartLine = t.app.lines[t.app.lines.length - 1];
  const c = t.app.beach.crabs.find((k) => k.controller.lineId === heartLine.id);
  if (c) c.controller.spec.burrowiness = 1;
  return c?.id ?? null;
});
console.log('walker', walker);
await page.waitForFunction(() => {
  const t = window.__tide, w = t.app.cove.waves.at(t.engine.elapsed);
  return w?.big && t.app.cove.waves.tau(t.engine.elapsed) > 0.62;
}, null, { timeout: 30000 });
await sleep(2600); // the sand glistens, then dries
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const t = window.__tide;
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type, lines: t.app.lines.length };
});
const file = `artifacts/tide-demo.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log(file, out.type, `${(out.ms / 1000).toFixed(1)} s`, `lines left ${out.lines}`);
await browser.close();
