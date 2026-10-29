import { expect, test } from '@playwright/test';
import { calmSea, depthAt, openBeach, toScreen } from './helpers';

test('Add a crab: a + cursor, a tap places a crab, and nothing is drawn', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  await page.getByRole('button', { name: /Add a crab/ }).click();
  await expect(page.getByText('or tap the sand')).toBeVisible();
  const [x, y] = await toScreen(page, 0.5, -2);
  await page.mouse.move(x, y);
  await expect(page.locator('.stage')).toHaveAttribute('data-cursor', 'place');
  await page.mouse.click(x, y);
  const [x2, y2] = await toScreen(page, -2, -1.5);
  await page.mouse.click(x2, y2);
  const s = await page.evaluate(() => {
    const t = window.__tide!, c = t.app.beach.crabs[4];
    return { n: t.app.beach.crabs.length, x: c.controller.x, z: c.controller.z, adding: t.store.get().addingCrab, lines: t.app.lines.length, undoable: t.store.get().undoable };
  });
  expect(s.n).toBe(6);
  expect(Math.hypot(s.x - 0.5, s.z + 2)).toBeLessThan(0.15);
  // the mode stays on for another tap; the fingertip never touched the sand
  expect(s.adding).toBe(true);
  expect(s.lines).toBe(0);
  expect(s.undoable).toBe(0);
  // the sea is not a place for a crab
  const [sx, sy] = await toScreen(page, 0, 4.5);
  await page.mouse.move(sx, sy);
  await expect(page.locator('.stage')).toHaveAttribute('data-cursor', 'not-allowed');
  await page.mouse.click(sx, sy);
  expect(await page.evaluate(() => window.__tide!.app.beach.crabs.length)).toBe(6);
  // Esc: back to drawing
  await page.keyboard.press('Escape');
  await page.mouse.move(x2 + 40, y2);
  await expect(page.locator('.stage')).toHaveAttribute('data-cursor', 'draw');
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => window.__tide!.app.beach.crabs[4].controller.pose.burrow)).toBeLessThan(0.2);
});

test('Add a crab: drawing a shell shows a white line, leaves the sand alone, and hatches a crab sized to it', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  await page.keyboard.press('c');
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push(await toScreen(page, 0.5 + Math.cos(a) * 0.45, -2 + Math.sin(a) * 0.36));
  }
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1, 30)) await page.mouse.move(x, y, { steps: 2 });
  // mid-stroke: the white line is there, and nothing is pressed into the sand
  await expect(page.locator('.ink-line').last()).toHaveAttribute('d', /Q/);
  expect(await page.evaluate(() => window.__tide!.app.lines.length)).toBe(0);
  for (const [x, y] of pts.slice(30)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
  const s = await page.evaluate(() => {
    const t = window.__tide!, c = t.app.beach.crabs[4];
    return { n: t.app.beach.crabs.length, x: c.controller.x, z: c.controller.z, size: c.view.size, lines: t.app.lines.length, adding: t.store.get().addingCrab };
  });
  expect(s.n).toBe(5);
  expect(Math.hypot(s.x - 0.5, s.z + 2)).toBeLessThan(0.15);
  expect(s.size).toBeGreaterThan(0.9);
  expect(s.lines).toBe(0);
  expect(s.adding).toBe(true);
  // the shell's line is only ink: no groove where it was drawn
  expect(Math.max(...(await depthAt(page, [[0.95, -2], [0.05, -2], [0.5, -1.64]])))).toBeLessThan(0.05);
  // an open line hatches nothing and says why
  const open: [number, number][] = [];
  for (let i = 0; i <= 20; i++) open.push(await toScreen(page, -2.5 + i * 0.1, -1.5));
  await page.mouse.move(...open[0]);
  await page.mouse.down();
  for (const [x, y] of open.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
  await expect(page.getByRole('status')).toContainText('Close the loop');
  expect(await page.evaluate(() => ({ n: window.__tide!.app.beach.crabs.length, lines: window.__tide!.app.lines.length }))).toEqual({ n: 5, lines: 0 });
});

test('undo keeps the paper behind the beach (it used to turn black)', async ({ page }) => {
  await openBeach(page);
  await calmSea(page);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 20; i++) pts.push(await toScreen(page, -2 + i * 0.1, -1.5));
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const r = window.__tide!.engine.renderer;
    const c = { r: 0, g: 0, b: 0, copy(o: { r: number; g: number; b: number }) { this.r = o.r; this.g = o.g; this.b = o.b; return this; } };
    r.getClearColor(c as never);
    return { a: r.getClearAlpha(), r: c.r, g: c.g, b: c.b };
  });
  expect(after.a).toBe(1);
  expect(after.r + after.g + after.b).toBeGreaterThan(2);
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
  // a crab that was underground comes up first, then joins the line
  expect(s.modes.every((m) => m === 'dance' || m === 'emerge')).toBe(true);
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
  // sunglasses on, disco lights up
  const disco = await page.evaluate(() => ({ lights: window.__tide!.engine.world.uDisco.value, shades: window.__tide!.app.beach.crabs.map((c) => c.controller.pose.shades) }));
  expect(disco.lights).toBeGreaterThan(0.9);
  expect(Math.min(...disco.shades)).toBeGreaterThan(0.9);
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
