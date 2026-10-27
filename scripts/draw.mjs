// Draw a word and a heart in the sand and film it: node scripts/draw.mjs [w] [h]
// -> artifacts/draw-*.png (frames while writing, close-up, after a wave)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { heart, word } from './shapes.mjs';

const [W = '1440', H = '900'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text().slice(0, 400)));
await page.goto('http://localhost:5388/');
await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading);
await page.waitForTimeout(1500);
const toScreen = (x, z) => page.evaluate(([x, z]) => {
  const t = window.__tide, y = t.app.heightAt(x, z);
  const p = t.engine.camera.position.clone().set(x, y, z).project(t.engine.camera);
  return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
}, [x, z]);
async function draw(strokes, cx, cz, shotPrefix) {
  let n = 0;
  for (const st of strokes) {
    const pts = [];
    for (const [x, z] of st) pts.push(await toScreen(cx + x, cz + z));
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      await page.mouse.move(pts[i][0], pts[i][1], { steps: 2 });
      if (shotPrefix && i % 12 === 0) await page.screenshot({ path: `artifacts/${shotPrefix}-${String(n++).padStart(2, '0')}.png` });
    }
    await page.mouse.up();
  }
}
await draw(word(1.3), -2.2, 0.2, process.env.FRAMES ? 'write' : null);
await draw(heart(1.2), 1.6, 1.2);
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/draw-overview.png' });
{
  const [ax, ay] = await toScreen(-3.4, 0.9), [bx, by] = await toScreen(2.8, -0.6);
  await page.screenshot({ path: 'artifacts/draw-crop.png', clip: { x: ax, y: by - 40, width: bx - ax, height: ay - by + 80 } });
}
// close-up at the app's camera angle
await page.evaluate(() => {
  const t = window.__tide, c = t.engine.camera;
  window.__cam = { p: c.position.clone(), fov: c.fov, q: c.quaternion.clone() };
  t.engine.debugView({ x: -0.6, y: 3.6, z: 4.3 }, { x: -0.6, y: 0, z: 0.6 }, 30);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/draw-close.png' });
console.log(JSON.stringify(await page.evaluate(() => {
  const t = window.__tide;
  return { lines: t.app.lines.length, crabs: t.app.beach.crabs.map((c) => [c.id, c.controller.mode, c.controller.x.toFixed(2), c.controller.z.toFixed(2)]) };
})));
await browser.close();
