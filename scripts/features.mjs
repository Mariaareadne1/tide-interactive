// Film the newer features: footprints, drawing a crab, and the dance. node scripts/features.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts/features', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text().slice(0, 300)));
await page.goto('http://localhost:5388/');
await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading);
await page.evaluate(() => { window.__tide.app.cove.waves.offset = -1e5; });
const toScreen = (x, z) => page.evaluate(([x, z]) => {
  const t = window.__tide, p = t.engine.camera.position.clone().set(x, t.app.heightAt(x, z), z).project(t.engine.camera);
  return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
}, [x, z]);
const shot = (name, clip) => page.screenshot({ path: `artifacts/features/${name}.png`, clip });

// 1. footprints: let the crabs potter for a while, then look closely
await page.waitForTimeout(9000);
const c = await page.evaluate(() => { const k = window.__tide.app.beach.get(2).controller; return [k.x, k.z]; });
const [fx, fy] = await toScreen(c[0], c[1]);
await shot('footprints', { x: fx - 200, y: fy - 110, width: 400, height: 220 });

// 2. add a crab: press the button, draw a loop
await page.getByRole('button', { name: /Add a crab/ }).click();
const loop = [];
for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; loop.push(await toScreen(-1 + Math.cos(a) * 0.4, -2 + Math.sin(a) * 0.3)); }
await page.mouse.move(...loop[0]);
await page.mouse.down();
for (const p of loop.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 });
const [lx, ly] = await toScreen(-1, -2);
await shot('hatch-0', { x: lx - 160, y: ly - 90, width: 320, height: 180 });
await page.mouse.up();
for (let i = 1; i <= 4; i++) {
  await page.waitForTimeout(300);
  await shot(`hatch-${i}`, { x: lx - 160, y: ly - 90, width: 320, height: 180 });
}
console.log('crabs', await page.evaluate(() => window.__tide.app.beach.crabs.length));

// 3. dance: select a crab, press Dance
await page.evaluate(() => window.__tide.store.set({ selection: { kind: 'crab', id: 1 } }));
await page.getByRole('button', { name: 'Dance' }).click();
const start = await page.evaluate(() => window.__tide.app.beach.danceStart - window.__tide.engine.elapsed);
console.log('song in', start.toFixed(2), 's; sound started', await page.evaluate(() => window.__tide.app.sound.started));
await page.waitForTimeout(start * 1000);
await page.evaluate(() => window.__tide.store.set({ selection: null, uiHidden: true }));
for (let i = 0; i < 10; i++) {
  await shot(`dance-${String(i).padStart(2, '0')}`, { x: 220, y: 300, width: 1000, height: 300 });
  await page.waitForTimeout(1800);
}
console.log(await page.evaluate(() => window.__tide.app.beach.crabs.map((c) => c.controller.mode).join(' ')));
await browser.close();
