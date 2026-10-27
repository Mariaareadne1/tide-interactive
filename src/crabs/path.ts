import { GONE, type LinePoint } from '../sand/lines';

/**
 * A walkable run of a line: the longest stretch of points the sea has left,
 * with arc lengths, and the places where it turns sharply enough that a
 * crab stops to look. Pure, so line-following can be tested off the GPU.
 */

export interface Path {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  /** Arc length at each point. */
  readonly s: Float64Array;
  readonly length: number;
  /** Arc positions of sharp corners (not the ends). */
  readonly corners: number[];
}

/** The longest contiguous run of points still in the sand. */
export function longestRun(points: readonly LinePoint[], minStrength = GONE): LinePoint[] {
  let best: LinePoint[] = [];
  let cur: LinePoint[] = [];
  for (const p of points) {
    if (p.s > minStrength) cur.push(p);
    else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  }
  return cur.length > best.length ? cur : best;
}

export function buildPath(points: readonly { x: number; z: number }[], cornerAngle = 0.75): Path | null {
  if (points.length < 2) return null;
  const n = points.length;
  const xs = new Float64Array(n), zs = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = points[i].x;
    zs[i] = points[i].z;
    if (i > 0) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  const length = s[n - 1];
  if (length < 0.05) return null;
  // corners: compare headings a few centimetres either side; keep one per bend
  const corners: number[] = [];
  const reach = 0.07;
  let lastCorner = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    if (s[i] < reach || s[i] > length - reach) continue;
    const a = pointAt({ xs, zs, s, length, corners }, s[i] - reach);
    const b = pointAt({ xs, zs, s, length, corners }, s[i] + reach);
    const h1 = Math.atan2(zs[i] - a.z, xs[i] - a.x);
    const h2 = Math.atan2(b.z - zs[i], b.x - xs[i]);
    let d = Math.abs(h2 - h1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > cornerAngle && s[i] - lastCorner > 0.2) {
      corners.push(s[i]);
      lastCorner = s[i];
    }
  }
  return { xs, zs, s, length, corners };
}

function segmentAt(path: Path, at: number): number {
  const { s } = path;
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= at) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position and unit tangent at arc length `at` (clamped to the path). */
export function pointAt(path: Path, at: number): { x: number; z: number; tx: number; tz: number } {
  const a = Math.min(path.length, Math.max(0, at));
  const i = segmentAt(path, a);
  const j = Math.min(path.s.length - 1, i + 1);
  const len = path.s[j] - path.s[i];
  const k = len > 0 ? (a - path.s[i]) / len : 0;
  const dx = path.xs[j] - path.xs[i], dz = path.zs[j] - path.zs[i];
  const dl = Math.hypot(dx, dz) || 1;
  return { x: path.xs[i] + dx * k, z: path.zs[i] + dz * k, tx: dx / dl, tz: dz / dl };
}

/** Distance from a point to the path (m), and the arc length of the nearest point. */
export function nearestOnPath(path: Path, x: number, z: number): { d: number; at: number } {
  let best = Infinity, at = 0;
  for (let i = 0; i + 1 < path.xs.length; i++) {
    const ax = path.xs[i], az = path.zs[i], bx = path.xs[i + 1], bz = path.zs[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) {
      best = d;
      at = path.s[i] + t * Math.sqrt(len2);
    }
  }
  return { d: best, at };
}
