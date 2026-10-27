import { describe, expect, test } from 'vitest';
import { WaveClock, frontProfile } from '../../src/sea/waves';

describe('the sea’s rhythm', () => {
  test('is a pure function of time and seed', () => {
    const a = new WaveClock({ seed: 7 }), b = new WaveClock({ seed: 7 });
    // ask b out of order: the answer must not depend on history
    for (const t of [90, 3, 41.7, 12.2]) b.front(0, t);
    for (let t = 0; t < 120; t += 0.37) expect(a.front(1.3, t)).toBe(b.front(1.3, t));
  });

  test('a wave comes every 5–8 s, big ones a little more slowly', () => {
    const c = new WaveClock({ seed: 3 });
    for (let k = 0; k < 60; k++) {
      const w = c.wave(k);
      const [lo, hi] = w.big ? [8.2, 9.4] : [5, 8];
      expect(w.duration).toBeGreaterThanOrEqual(lo);
      expect(w.duration).toBeLessThanOrEqual(hi);
      if (k > 0) expect(w.start).toBeCloseTo(c.wave(k - 1).start + c.wave(k - 1).duration, 9);
    }
  });

  test('every fourth or fifth wave runs high', () => {
    const c = new WaveClock({ seed: 11 });
    const bigs: number[] = [];
    for (let k = 0; k < 100; k++) if (c.wave(k).big) bigs.push(k);
    expect(bigs.length).toBeGreaterThan(18);
    for (let i = 1; i < bigs.length; i++) expect([4, 5]).toContain(bigs[i] - bigs[i - 1]);
    for (let k = 0; k < 100; k++) {
      const w = c.wave(k);
      if (w.big) expect(w.reach).toBeGreaterThan(3.6);
      else expect(w.reach).toBeLessThan(2.4);
    }
  });

  test('the front runs up, pauses, draws back and rests', () => {
    expect(frontProfile(0)).toBe(0);
    expect(frontProfile(0.15)).toBeGreaterThan(0.6);
    expect(frontProfile(0.3)).toBeCloseTo(1, 5);
    expect(frontProfile(0.35)).toBeGreaterThan(0.95);
    expect(frontProfile(0.65)).toBeLessThan(frontProfile(0.45));
    expect(frontProfile(0.95)).toBe(0);
    let prev = 1;
    for (let t = 0.4; t <= 0.9; t += 0.01) {
      expect(frontProfile(t)).toBeLessThanOrEqual(prev + 1e-9);
      prev = frontProfile(t);
    }
  });

  test('scheduleBig lines the next big wave up with a moment', () => {
    const c = new WaveClock({ seed: 7 });
    c.scheduleBig(10, 3);
    const w = c.at(13.01)!;
    expect(w.big).toBe(true);
    expect(c.tau(13.01)).toBeLessThan(0.01);
  });

  test('reduced motion stretches the rhythm', () => {
    const slow = new WaveClock({ seed: 7, tempo: 1.4 }), norm = new WaveClock({ seed: 7 });
    expect(slow.wave(5).duration).toBeCloseTo(norm.wave(5).duration * 1.4, 9);
    expect(slow.wave(5).reach).toBe(norm.wave(5).reach);
  });
});
