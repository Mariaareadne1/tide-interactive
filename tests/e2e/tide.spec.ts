import { expect, test } from '@playwright/test';
import { calmSea, captureStats, depthAt, drawWorld, heartWorld, mean, openBeach, toScreen } from './helpers';

test.describe('the beach', () => {
  test('renders a painted cove on paper', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openBeach(page);
    await page.waitForTimeout(1000);
    const s = await captureStats(page);
    expect(s.paper).toBeGreaterThan(0.15);
    expect(s.sand).toBeGreaterThan(0.2);
    expect(s.sea).toBeGreaterThan(0.08);
    await expect(page.getByRole('heading', { name: 'TIDE' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a line drawn in the sand makes a measurable groove, and only there', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 30; i++) pts.push([-2 + i * 0.1, -0.5 + Math.sin(i * 0.3) * 0.2]);
    await drawWorld(page, pts);
    await page.waitForTimeout(200);
    const on = await depthAt(page, pts.slice(3, -3));
    const off = await depthAt(page, pts.slice(3, -3).map(([x, z]) => [x, z - 0.6]));
    expect(Math.min(...on)).toBeGreaterThan(0.4);
    expect(Math.max(...off)).toBe(0);
    expect(await page.evaluate(() => window.__tide!.app.lines.length)).toBe(1);
  });

  test('a crab arrives at a fresh line and walks along it', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    const heart = heartWorld(1.5, -1.2, 0.55);
    await drawWorld(page, heart);
    const result = await page.evaluate(async (heart) => {
      const t = window.__tide!, line = t.app.lines[0];
      const dist = (x: number, z: number) => Math.min(...heart.map(([hx, hz]) => Math.hypot(hx - x, hz - z)));
      const start = performance.now();
      let arrived = -1, along = 0, maxOff = 0;
      const seen = new Set<number>();
      while (performance.now() - start < 25000) {
        await new Promise((r) => requestAnimationFrame(r));
        for (const c of t.app.beach.crabs) {
          const k = c.controller;
          if (k.mode === 'follow' && k.lineId === line.id) {
            if (arrived < 0) arrived = (performance.now() - start) / 1000;
            along++;
            maxOff = Math.max(maxOff, dist(k.x, k.z));
            seen.add(Math.round(Math.atan2(k.z + 1.2, k.x - 1.5) * 4));
          }
        }
        if (seen.size >= 16) break;
      }
      return { arrived, along, maxOff, seen: seen.size };
    }, heart);
    expect(result.arrived).toBeGreaterThan(0);
    expect(result.arrived).toBeLessThan(12);
    expect(result.maxOff).toBeLessThan(0.08);
    expect(result.seen).toBeGreaterThanOrEqual(12); // most of the way round
  });

  test('a big wave washes a groove away; one beyond its reach survives', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    const low: [number, number][] = [], high: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      low.push([-4 + i * 0.1, 1.6]); // ~1.7 m up the beach
      high.push([-4 + i * 0.1, -4.3]); // in the dunes' lee, beyond any wave
    }
    await drawWorld(page, low);
    await drawWorld(page, high);
    await page.waitForTimeout(150);
    const before = mean(await depthAt(page, low.slice(2, -2)));
    const beforeHigh = mean(await depthAt(page, high.slice(2, -2)));
    // bring the next big wave in now and let it run its whole cycle
    await page.evaluate(() => {
      const t = window.__tide!;
      t.app.cove.waves.offset = 0;
      t.app.cove.waves.scheduleBig(t.engine.elapsed, 0.5);
    });
    await page.waitForFunction(() => {
      const t = window.__tide!, w = t.app.cove.waves.at(t.engine.elapsed);
      return w?.big && t.app.cove.waves.tau(t.engine.elapsed) > 0.9;
    }, null, { timeout: 30_000 });
    const after = mean(await depthAt(page, low.slice(2, -2)));
    const afterHigh = mean(await depthAt(page, high.slice(2, -2)));
    expect(before).toBeGreaterThan(0.5);
    expect(after).toBeLessThan(before * 0.5);
    expect(afterHigh).toBeCloseTo(beforeHigh, 3);
    // the sea has touched it: it can no longer be undone
    expect(await page.evaluate(() => window.__tide!.app.lines.find((l) => l.points[0].z > 1)?.touched ?? true)).toBe(true);
  });

  test('undo smooths the last line back over', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    const a: [number, number][] = [], b: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      a.push([-3 + i * 0.1, -1]);
      b.push([-3 + i * 0.1, -2]);
    }
    await drawWorld(page, a);
    await drawWorld(page, b);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(900);
    expect(Math.max(...(await depthAt(page, b.slice(2, -2))))).toBeLessThan(0.02);
    expect(Math.min(...(await depthAt(page, a.slice(2, -2))))).toBeGreaterThan(0.4);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(900);
    expect(Math.max(...(await depthAt(page, a.slice(2, -2))))).toBeLessThan(0.02);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('drawing off the tile or on the sea makes no line', async ({ page }) => {
    await openBeach(page);
    await page.mouse.move(40, 120);
    await page.mouse.down();
    await page.mouse.move(200, 140, { steps: 10 });
    await page.mouse.up();
    const [sx, sy] = await toScreen(page, 0, 5.5);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 120, sy, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__tide!.app.lines.length)).toBe(0);
    // the sea got a ripple
    expect(await page.evaluate(() => window.__tide!.engine.world.uRipples.value.some((r) => r.w > 0))).toBe(true);
  });
});

test.describe('crabs', () => {
  async function selectCrab(page: import('@playwright/test').Page, id: number) {
    const [x, y] = await page.evaluate((id) => {
      const t = window.__tide!, c = t.app.beach.get(id)!, p = c.centre(c.view.root.position.clone()).project(t.engine.camera);
      const r = t.engine.canvas.getBoundingClientRect();
      return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
    }, id);
    await page.mouse.click(x, y);
    await expect(page.getByRole('toolbar', { name: 'Selected crab' })).toBeVisible();
  }

  test('clicking a crab selects it; its three actions change real state', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    await page.evaluate(() => (window.__tide!.engine.paused = true)); // hold still for the click
    await selectCrab(page, 2);
    await page.evaluate(() => (window.__tide!.engine.paused = false));
    const bar = page.getByRole('toolbar', { name: 'Selected crab' });
    await expect(page.locator('.select-label')).toContainText('cm');

    await bar.getByRole('button', { name: 'Wave' }).click();
    expect(await page.evaluate(() => window.__tide!.app.beach.get(2)!.controller.mode)).toBe('wave');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__tide!.app.beach.get(2)!.controller.pose.clawL)).toBeGreaterThan(0.6);

    await bar.getByRole('button', { name: 'Burrow' }).click();
    await page.waitForTimeout(1800);
    expect(await page.evaluate(() => window.__tide!.app.beach.get(2)!.controller.pose.burrow)).toBeGreaterThan(0.85);
    await bar.getByRole('button', { name: 'Come out' }).click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__tide!.app.beach.get(2)!.controller.pose.burrow)).toBeLessThan(0.05);

    // no lines yet: it waits for the next one
    await bar.getByRole('button', { name: 'Follow a line' }).click();
    expect(await page.evaluate(() => window.__tide!.app.beach.get(2)!.controller.waitingForLine)).toBe(true);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 25; i++) pts.push([-7 + i * 0.1, 0.2]); // far from crab 2, near crab 4
    await drawWorld(page, pts);
    const c2 = await page.evaluate(() => { const k = window.__tide!.app.beach.get(2)!.controller; return { mode: k.mode, line: k.lineId }; });
    expect(['approach', 'follow']).toContain(c2.mode);
    expect(c2.line).not.toBeNull();
  });

  test('a crab can be carried across the sand', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    await page.evaluate(() => (window.__tide!.engine.paused = true));
    const from = await page.evaluate(() => {
      const t = window.__tide!, c = t.app.beach.get(1)!, p = c.centre(c.view.root.position.clone()).project(t.engine.camera);
      return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
    });
    const to = await toScreen(page, 0.5, -2);
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 12 });
    expect(await page.evaluate(() => window.__tide!.app.beach.get(1)!.controller.mode)).toBe('held');
    await page.mouse.up();
    const p = await page.evaluate(() => { const k = window.__tide!.app.beach.get(1)!.controller; return [k.x, k.z]; });
    expect(Math.hypot(p[0] - 0.5, p[1] + 2)).toBeLessThan(0.15);
    expect(await page.evaluate(() => window.__tide!.app.lines.length)).toBe(0);
  });
});

test.describe('capture and devices', () => {
  test('Save image downloads a PNG of the rendered sand', async ({ page }) => {
    await openBeach(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save image' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^tide-.*\.png$/);
    const stats = await captureStats(page);
    expect(stats.width).toBeGreaterThan(1400);
    expect(stats.sand).toBeGreaterThan(0.2);
  });

  test('the recorder captures the live groove and waves (no overlay needed)', async ({ page }) => {
    await openBeach(page);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 20; i++) pts.push([-1 + i * 0.1, 0.5]);
    await drawWorld(page, pts);
    const rec = await page.evaluate(async () => {
      const r = await window.__tide!.record(window.__tide!.engine.canvas, { seconds: 2 });
      return { size: r.blob.size, type: r.type, ms: r.durationMs };
    });
    expect(rec.size).toBeGreaterThan(20_000);
    expect(rec.ms).toBeGreaterThan(1800);
  });

  test('a finger on a phone draws in the sand', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await openBeach(page);
    await calmSea(page);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 20; i++) pts.push([-1, -2 + i * 0.12]);
    const screen = [];
    for (const [x, z] of pts) screen.push(await toScreen(page, x, z));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: [number, number]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
    await touch('touchStart', screen[0]);
    for (const p of screen.slice(1)) await touch('touchMove', p);
    await touch('touchEnd');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__tide!.app.lines.length)).toBe(1);
    expect(mean(await depthAt(page, pts.slice(3, -3)))).toBeGreaterThan(0.4);
    await ctx.close();
  });

  test('reduced motion gives a slower, gentler sea', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBeach(page);
    const r = await page.evaluate(() => {
      const t = window.__tide!;
      return { reduced: t.engine.reducedMotion, tempo: t.app.cove.waves.tempo, calm: t.engine.world.uCalm.value };
    });
    expect(r).toEqual({ reduced: true, tempo: 1.4, calm: 1 });
  });

  test('after the graphics context is lost and restored, the sand is smooth again', async ({ page }) => {
    await openBeach(page);
    await calmSea(page);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 20; i++) pts.push([-1 + i * 0.1, -1]);
    await drawWorld(page, pts);
    await page.evaluate(async () => {
      const gl = window.__tide!.engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context')!;
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 300));
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(await page.evaluate(() => window.__tide!.app.lines.length)).toBe(0);
    expect(Math.max(...(await depthAt(page, pts)))).toBe(0);
    const s = await captureStats(page);
    expect(s.sand).toBeGreaterThan(0.2);
  });
});
