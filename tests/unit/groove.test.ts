import { describe, expect, test } from 'vitest';
import { SandGrid, grooveHeight, grooveProfile, GROOVE_HALF_WIDTH, erodeValue } from '../../src/sand/groove';
import { resample, lineLength } from '../../src/sand/lines';

const wet = () => 1;

describe('stroke resampling', () => {
  test('spaces points evenly and keeps both ends', () => {
    const pts = resample([{ x: 0, z: 0 }, { x: 0.05, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 0.5 }], 0.02);
    expect(pts[0]).toEqual({ x: 0, z: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 1, z: 0.5 });
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      expect(d).toBeLessThanOrEqual(0.0201);
      expect(d).toBeGreaterThan(0.003);
    }
    expect(lineLength(pts)).toBeCloseTo(1.5, 1);
  });
});

describe('the groove a fingertip presses', () => {
  test('is deepest on the line, with a lip either side', () => {
    const on = grooveProfile(0, 1), lipAt = grooveProfile(GROOVE_HALF_WIDTH * 1.25, 1), far = grooveProfile(1, 1);
    expect(grooveHeight(on.depth, on.lip)).toBeLessThan(-0.03);
    expect(grooveHeight(lipAt.depth, lipAt.lip)).toBeGreaterThan(0.005);
    expect(far.depth).toBe(0);
    expect(far.lip).toBeLessThan(1e-6);
  });

  test('is crisper and deeper on wet sand, wider and softer on dry', () => {
    const w = grooveProfile(0, 1), d = grooveProfile(0, 0);
    expect(w.depth).toBeGreaterThan(d.depth);
    const edge = GROOVE_HALF_WIDTH * 1.05;
    expect(grooveProfile(edge, 0).depth).toBeGreaterThan(grooveProfile(edge, 1).depth);
  });

  test('stamping changes the sand along the stroke and nowhere else', () => {
    const g = new SandGrid(400, 300, 10, 7.5);
    const stroke = resample([{ x: -1, z: 0 }, { x: 1, z: 0.4 }], 0.02);
    g.stamp(stroke, wet);
    for (let k = 0; k <= 10; k++) {
      const x = -1 + (k / 10) * 2, z = (k / 10) * 0.4;
      expect(g.heightAt(x, z)).toBeLessThan(-0.025);
    }
    // away from the stroke the sand is untouched
    for (const [x, z] of [[0, 2], [-3, 0], [3, -3], [0, -0.6]]) expect(g.heightAt(x, z)).toBe(0);
  });

  test('drawing over a line twice does not deepen it (max-combined)', () => {
    const a = new SandGrid(200, 150, 10, 7.5), b = new SandGrid(200, 150, 10, 7.5);
    const s = resample([{ x: -1, z: 0 }, { x: 1, z: 0 }], 0.02);
    a.stamp(s, wet);
    b.stamp(s, wet);
    b.stamp(s, wet);
    expect(Array.from(b.depth)).toEqual(Array.from(a.depth));
  });
});

describe('the sea wears grooves down', () => {
  const stroke = resample([{ x: -1, z: 1 }, { x: 1, z: 1 }], 0.02);
  const depthOn = (g: SandGrid, z: number) => {
    let m = 0;
    for (let x = -0.9; x <= 0.9; x += 0.05) m = Math.max(m, g.depth[g.index(x, z)]);
    return m;
  };

  test('monotonically inside the water, and not at all beyond it', () => {
    const g = new SandGrid(200, 150, 10, 7.5);
    g.stamp(stroke, wet);
    g.stamp(resample([{ x: -1, z: -2 }, { x: 1, z: -2 }], 0.02), wet);
    const cover = (_x: number, z: number) => (z > 0 ? 1 : 0); // water over the near line only
    let prev = depthOn(g, 1);
    const far0 = Array.from(g.depth.filter((_, k) => Math.floor(k / 200) < 70));
    for (let i = 0; i < 40; i++) {
      g.erode(cover, 1 / 15);
      const d = depthOn(g, 1);
      expect(d).toBeLessThanOrEqual(prev + 1e-7);
      prev = d;
    }
    expect(prev).toBeLessThan(0.45);
    expect(Array.from(g.depth.filter((_, k) => Math.floor(k / 200) < 70))).toEqual(far0);
  });

  test('a single texel never rises above itself while smearing', () => {
    for (const v of [0, 0.2, 1]) for (const blur of [0, 0.5, 1]) for (const c of [0, 0.5, 1]) {
      expect(erodeValue(v, blur, c, 0.1)).toBeLessThanOrEqual(v + 1e-9);
      expect(erodeValue(v, blur, c, 0.1)).toBeGreaterThanOrEqual(0);
    }
    expect(erodeValue(0.8, 0.8, 0, 1)).toBe(0.8);
  });
});
