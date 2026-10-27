import type { Page } from '@playwright/test';

export async function openBeach(page: Page, query = ''): Promise<void> {
  await page.goto(query ? `/?${query}` : '/');
  await page.waitForFunction(() => window.__tide && !window.__tide.store.get().loading, null, { timeout: 90_000 });
}

/** A world point on the beach in client pixels. */
export async function toScreen(page: Page, x: number, z: number): Promise<[number, number]> {
  return page.evaluate(([x, z]) => {
    const t = window.__tide!, r = t.engine.canvas.getBoundingClientRect();
    const p = t.engine.camera.position.clone().set(x, t.app.heightAt(x, z), z).project(t.engine.camera);
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height] as [number, number];
  }, [x, z]);
}

/** A heart in world metres around (cx, cz). */
export function heartWorld(cx: number, cz: number, size = 0.6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    out.push([cx + ((16 * Math.sin(t) ** 3) / 17) * size, cz - ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17) * size]);
  }
  return out;
}

/** Draw through world points with the mouse. */
export async function drawWorld(page: Page, pts: [number, number][]): Promise<void> {
  const screen: [number, number][] = [];
  for (const [x, z] of pts) screen.push(await toScreen(page, x, z));
  await page.mouse.move(...screen[0]);
  await page.mouse.down();
  for (const [x, y] of screen.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
}

/** Groove depth read back from the GPU heightmap at world points. */
export async function depthAt(page: Page, pts: [number, number][]): Promise<number[]> {
  return page.evaluate((pts) => {
    const t = window.__tide!;
    return t.app.cove.sand.read(t.engine.renderer, pts.map(([x, z]) => ({ x, z }))).map((r) => r.depth);
  }, pts);
}

export const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

/** Keep the sea away (no waves for a long while) so a test can look at the sand undisturbed. */
export async function calmSea(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__tide!.app.cove.waves.offset = -1e5;
  });
}

/** Render a PNG through the app's capture path and measure its pixels. */
export async function captureStats(page: Page) {
  return page.evaluate(async () => {
    const blob = await window.__tide!.engine.capturePNG(1);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let paper = 0, sand = 0, sea = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      n++;
      if (r > 225 && g > 220 && b > 205 && r - b < 30) paper++;
      else if (r > 180 && r > g && g > b + 25) sand++;
      else if (b > r + 30 && g > r) sea++;
    }
    return { width: bmp.width, height: bmp.height, size: blob.size, paper: paper / n, sand: sand / n, sea: sea / n };
  });
}
