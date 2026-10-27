// The dance, with sound, through the app's own recorder: a shell is drawn and a crab
// digs out of it, then everyone lines up and dances to the song.
// node scripts/demo-dance.mjs [width] [height] [url]  ->  artifacts/tide-dance.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const [W = '1600', H = '900', URL = 'http://localhost:5388/'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading, null, { timeout: 90000 });
const sleep = (ms) => page.waitForTimeout(ms);
const toScreen = (x, z) => page.evaluate(([x, z]) => {
  const t = window.__tide, p = t.engine.camera.position.clone().set(x, t.app.heightAt(x, z), z).project(t.engine.camera);
  return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
}, [x, z]);
await page.evaluate(() => {
  const t = window.__tide;
  t.app.sound.unlock();
  t.app.setSound(true);
  t.store.set({ uiHidden: true, hasDrawn: true });
  t.engine.adaptive = false;
  // keep the big waves for after the song
  t.app.cove.waves.scheduleBig(t.engine.elapsed, 40);
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = t.record(t.engine.canvas, { seconds: 60, audio: t.app.sound.stream, until: window.__demoDone });
});
await sleep(1200);
await page.evaluate(() => window.__tide.app.toggleAddCrab());
const loop = [];
for (let i = 0; i <= 44; i++) { const a = Math.PI / 2 + (i / 44) * Math.PI * 2; loop.push(await toScreen(0.4 + Math.cos(a) * 0.42, -1.2 + Math.sin(a) * 0.33)); }
await page.mouse.move(...loop[0]);
await page.mouse.down();
for (const p of loop.slice(1)) { await page.mouse.move(p[0], p[1]); await sleep(20); }
await page.mouse.up();
await sleep(2200); // the new crab digs out and looks about
const until = await page.evaluate(() => { const t = window.__tide; t.app.dance(); return t.app.beach.danceStart - t.engine.elapsed; });
await sleep((until + 21.4 + 0.8) * 1000);
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type };
});
const file = `artifacts/tide-dance.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log(file, out.type, `${(out.ms / 1000).toFixed(1)} s`);
await browser.close();
