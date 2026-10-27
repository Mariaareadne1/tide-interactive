import { expect, test } from '@playwright/test';
import { calmSea, depthAt, openBeach, toScreen } from './helpers';

async function drawLoop(page: import('@playwright/test').Page, cx: number, cz: number, r: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push(await toScreen(page, cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.8));
  }
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
}

test('Add a crab, then draw a shell: the groove smooths away and a crab digs out of it', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  await page.getByRole('button', { name: /Add a crab/ }).click();
  await expect(page.getByText('Draw a shell')).toBeVisible();
  await drawLoop(page, 0.5, -2, 0.42);
  const crab = await page.evaluate(() => {
    const t = window.__tide!, c = t.app.beach.crabs[t.app.beach.crabs.length - 1];
    return { n: t.app.beach.crabs.length, x: c.controller.x, z: c.controller.z, size: c.view.size, adding: t.store.get().addingCrab, lines: t.app.lines.length };
  });
  expect(crab.n).toBe(5);
  expect(Math.hypot(crab.x - 0.5, crab.z + 2)).toBeLessThan(0.15);
  expect(crab.size).toBeGreaterThan(0.7);
  expect(crab.adding).toBe(false);
  expect(crab.lines).toBe(0);
  await page.waitForTimeout(1600);
  // the shell's groove has smoothed over, and the crab is up and about
  expect(Math.max(...(await depthAt(page, [[0.92, -2], [0.08, -2]])))).toBeLessThan(0.1);
  expect(await page.evaluate(() => { const c = window.__tide!.app.beach.crabs[4].controller; return c.pose.burrow; })).toBeLessThan(0.2);
});

test('in Add a crab, an open line stays a line', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  await page.keyboard.press('c');
  const pts: [number, number][] = [];
  for (let i = 0; i <= 20; i++) pts.push(await toScreen(page, -2 + i * 0.1, -1.5));
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
  await expect(page.getByRole('status')).toContainText('Close the loop');
  expect(await page.evaluate(() => ({ n: window.__tide!.app.beach.crabs.length, lines: window.__tide!.app.lines.length, adding: window.__tide!.store.get().addingCrab }))).toEqual({ n: 4, lines: 1, adding: true });
});

test('Dance: every crab lines up along the shore and dances to the song', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  await page.evaluate(() => window.__tide!.store.set({ selection: { kind: 'crab', id: 3 } }));
  await page.getByRole('toolbar', { name: 'Selected crab' }).getByRole('button', { name: 'Dance' }).click();
  const s = await page.evaluate(() => {
    const t = window.__tide!;
    return { delay: t.app.beach.danceStart! - t.engine.elapsed, modes: t.app.beach.crabs.map((c) => c.controller.mode), audio: t.app.sound.started, song: t.app.sound.songPlaying };
  });
  expect(s.modes.every((m) => m === 'dance')).toBe(true);
  expect(s.audio).toBe(true);
  expect(s.song).toBe(true);
  expect(s.delay).toBeGreaterThan(1.5);
  expect(s.delay).toBeLessThanOrEqual(6);
  // a few beats into the song: all in a row, facing the front, moving
  await page.waitForTimeout((s.delay + 4) * 1000);
  const row = await page.evaluate(() => window.__tide!.app.beach.crabs.map((c) => ({ x: c.controller.x, z: c.controller.z, dancing: c.controller.dancing !== null })));
  expect(row.every((c) => c.dancing)).toBe(true);
  const xs = row.map((c) => c.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.6);
  const zs = row.map((c) => c.z);
  expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(0.8);
});

test('crabs leave footprints in the sand', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  await page.waitForFunction(() => window.__tide!.app.beach.marksMade > 40, null, { timeout: 30_000 });
  const foot = await page.evaluate(() => window.__tide!.app.beach.lastMark!);
  const [d] = await depthAt(page, [[foot.x, foot.z]]);
  expect(d).toBeGreaterThan(0.1);
});

test('the sound toggle mutes, and is remembered', async ({ page }) => {
  await openBeach(page);
  await page.mouse.click(30, 300); // a first touch lets audio start
  await page.getByRole('button', { name: 'Mute sound' }).click();
  expect(await page.evaluate(() => ({ on: window.__tide!.app.sound.enabled, pref: localStorage.getItem('tide-sound') }))).toEqual({ on: false, pref: 'off' });
  await page.reload();
  await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading);
  await expect(page.getByRole('button', { name: 'Turn sound on' })).toBeVisible();
  await page.getByRole('button', { name: 'Turn sound on' }).click();
  expect(await page.evaluate(() => localStorage.getItem('tide-sound'))).toBe('on');
});

test('a recording carries the sound', async ({ page }) => {
  await openBeach(page);
  await page.mouse.click(30, 300);
  const rec = await page.evaluate(async () => {
    const t = window.__tide!;
    t.app.dance();
    const r = await t.record(t.engine.canvas, { seconds: 2, audio: t.app.sound.stream });
    return { type: r.type, size: r.blob.size };
  });
  expect(rec.type).toMatch(/mp4a|opus/);
  expect(rec.size).toBeGreaterThan(20_000);
});
