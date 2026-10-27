import { describe, expect, test } from 'vitest';
import { CrabController, type CrabWorld } from '../../src/crabs/CrabController';
import { behave, type BehaviourName } from '../../src/crabs/behaviours';
import { buildPath, nearestOnPath, pointAt, longestRun } from '../../src/crabs/path';
import { isFinitePose, CRAB_KEYS } from '../../src/crabs/pose';
import { resample, type SandLine } from '../../src/sand/lines';
import { WaveClock } from '../../src/sea/waves';
import { isWalkable, upBeach } from '../../src/scene/beach';

function heartLine(id: number, cx: number, cz: number, size = 0.6): SandLine {
  const raw = [];
  for (let i = 0; i <= 80; i++) {
    const t = (i / 80) * Math.PI * 2;
    raw.push({ x: cx + (16 * Math.sin(t) ** 3 / 17) * size, z: cz - ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17) * size });
  }
  return { id, points: resample(raw, 0.02).map((p) => ({ ...p, s: 1 })), pressure: 1, createdAt: 0, touched: false, open: false };
}

/** A calm sea far away (the first wave never comes), so tests can isolate behaviour. */
function calm(): WaveClock {
  const w = new WaveClock({ seed: 1 });
  w.offset = -1e6;
  return w;
}

function world(lines: SandLine[], waves = calm()): CrabWorld {
  return { waves, line: (id) => lines.find((l) => l.id === id), others: () => [] };
}

describe('line paths', () => {
  test('find the corners of a heart and keep positions on it', () => {
    const line = heartLine(1, 0, -1);
    const path = buildPath(longestRun(line.points))!;
    expect(path.length).toBeGreaterThan(2);
    // a heart has a dip at the top and a point at the bottom
    expect(path.corners.length).toBeGreaterThanOrEqual(1);
    for (let s = 0; s <= path.length; s += 0.05) {
      const p = pointAt(path, s);
      expect(nearestOnPath(path, p.x, p.z).d).toBeLessThan(1e-6);
      expect(Math.hypot(p.tx, p.tz)).toBeCloseTo(1, 6);
    }
  });

  test('skip the parts the sea has taken', () => {
    const line = heartLine(1, 0, -1);
    line.points.forEach((p, i) => (p.s = i > 40 && i < 60 ? 0.05 : 1));
    const run = longestRun(line.points);
    expect(run.every((p) => p.s > 0.18)).toBe(true);
    expect(run.length).toBeLessThan(line.points.length - 19);
  });
});

describe('a crab following a line', () => {
  test('arrives, walks the whole heart, and stays on it within tolerance', () => {
    const line = heartLine(1, 1.5, -0.5);
    const crab = new CrabController({ id: 1, seed: 1, home: { x: 0, z: -1 }, burrowiness: 0 });
    const w = world([line]);
    crab.goFollow(line, 0);
    const path = buildPath(longestRun(line.points))!;
    let followed = 0, maxOff = 0, t = 0;
    const visited = new Set<number>();
    for (; t < 40; t += 1 / 60) {
      crab.update(1 / 60, t, w);
      if (crab.mode === 'follow') {
        followed++;
        const n = nearestOnPath(path, crab.x, crab.z);
        maxOff = Math.max(maxOff, n.d);
        visited.add(Math.round(n.at / 0.2));
      }
      if (crab.walked.has(1)) break;
    }
    expect(followed).toBeGreaterThan(60);
    expect(maxOff).toBeLessThan(0.01);
    expect(crab.walked.has(1)).toBe(true);
    // it covered the line end to end
    expect(visited.size).toBeGreaterThan(path.length / 0.2 - 2);
  });

  test('pauses at corners', () => {
    const line: SandLine = { id: 2, points: resample([{ x: -1, z: -1 }, { x: 0, z: -1 }, { x: 0, z: -2 }], 0.02).map((p) => ({ ...p, s: 1 })), pressure: 1, createdAt: 0, touched: false, open: false };
    const crab = new CrabController({ id: 1, seed: 2, home: { x: -1.2, z: -1 }, burrowiness: 0 });
    const w = world([line]);
    crab.goFollow(line, 0);
    let still = 0, t = 0, nearCorner = false;
    for (; t < 15 && !crab.walked.has(2); t += 1 / 60) {
      crab.update(1 / 60, t, w);
      if (crab.mode === 'follow' && Math.hypot(crab.x, crab.z + 1) < 0.02) {
        nearCorner = true;
        if (crab.speed < 0.01) still++;
      }
    }
    expect(nearCorner).toBe(true);
    expect(still).toBeGreaterThan(30); // ~0.75 s at the corner
  });
});

describe('crabs and waves', () => {
  test('a crab on the wet sand gets out of the way or burrows before the water reaches it', () => {
    const waves = new WaveClock({ seed: 7 });
    const big = waves.nextBigAfter(5);
    for (const [seed, burrowiness] of [[1, 1], [2, 0]] as const) {
      const crab = new CrabController({ id: seed, seed, home: { x: 0, z: 1.2 }, burrowiness });
      const w = world([], waves);
      let caughtStanding = 0;
      for (let t = big.start - 6; t < big.start + big.duration; t += 1 / 30) {
        crab.update(1 / 30, t, w);
        const under = waves.front(crab.x, t) > upBeach(crab.x, crab.z) + 0.05;
        if (under && !crab.burrowed && crab.mode !== 'emerge') caughtStanding++;
      }
      expect(caughtStanding).toBeLessThan(10);
    }
  });
});

describe('behaviours and controllers stay sane', () => {
  test('every behaviour is finite over long runs', () => {
    const names: BehaviourName[] = ['idle', 'walk', 'look', 'wave', 'dig', 'burrow', 'buried', 'emerge', 'held'];
    for (const n of names) for (let t = 0; t < 600; t += 0.731) {
      const p = behave(n, t, 3);
      expect(isFinitePose(p)).toBe(true);
      for (const k of CRAB_KEYS) expect(Math.abs(p[k])).toBeLessThan(5);
    }
  });

  test('fuzzing requests, drags and lines never breaks a crab', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const waves = new WaveClock({ seed: 5 });
    const lines: SandLine[] = [];
    const w: CrabWorld = { waves, line: (id) => lines.find((l) => l.id === id), others: () => [{ x: 0, z: 0 }] };
    const crabs = [1, 2, 3].map((i) => new CrabController({ id: i, seed: i, home: { x: -2 + i, z: 0.5 }, burrowiness: 0.5 }));
    let t = 0;
    for (let step = 0; step < 20000; step++) {
      const dt = rnd() < 0.02 ? 0 : 1 / 60 + rnd() * 0.04;
      t += dt;
      const r = rnd();
      const c = crabs[Math.floor(rnd() * crabs.length)];
      if (r < 0.002) {
        lines.push(heartLine(lines.length + 1, -3 + rnd() * 6, -2 + rnd() * 3, 0.3 + rnd() * 0.5));
        c.goFollow(lines[lines.length - 1], t);
      } else if (r < 0.003) c.waveClaws(t);
      else if (r < 0.004) c.toggleBurrow(t);
      else if (r < 0.005) {
        c.grab();
        c.dragTo(-12 + rnd() * 24, -9 + rnd() * 18);
        c.release(t);
      } else if (r < 0.006 && lines.length) lines.splice(Math.floor(rnd() * lines.length), 1);
      else if (r < 0.007 && lines.length) lines[0].points.forEach((p) => (p.s *= 0.5));
      for (const k of crabs) {
        k.update(dt, t, w);
        expect(Number.isFinite(k.x) && Number.isFinite(k.z) && Number.isFinite(k.heading) && Number.isFinite(k.phase)).toBe(true);
        expect(isFinitePose(k.pose)).toBe(true);
      }
    }
    // after all that, they're still on the beach
    for (const k of crabs) expect(isWalkable(k.x, k.z) || upBeach(k.x, k.z) > -1).toBe(true);
  });
});
