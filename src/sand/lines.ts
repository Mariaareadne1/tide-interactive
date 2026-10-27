import { upBeach } from '../scene/beach';
import { ERODE_RATE } from './groove';
import type { WaveClock } from '../sea/waves';

/**
 * The lines pressed into the sand, kept on the CPU as resampled world-space
 * polylines. Each point carries a strength that the sea wears down exactly
 * as the GPU evolve pass wears down the groove's depth (without the
 * smearing), so crabs know what is left to follow and undo knows whether
 * the sea has touched a line yet.
 */

export interface LinePoint {
  x: number;
  z: number;
  /** 1 fresh .. 0 washed away. */
  s: number;
}

export interface SandLine {
  readonly id: number;
  readonly points: LinePoint[];
  readonly pressure: number;
  readonly createdAt: number;
  /** The sea has reached some of it: it can no longer be undone. */
  touched: boolean;
  /** Still being drawn. */
  open: boolean;
}

/** Points weaker than this no longer count as a line. */
export const GONE = 0.18;

/** Resample a world polyline to even spacing (keeps both ends). */
export function resample(points: readonly { x: number; z: number }[], spacing: number): { x: number; z: number }[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, z: p.z }));
  const out = [{ x: points[0].x, z: points[0].z }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = spacing - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > spacing * 0.25) out.push({ x: last.x, z: last.z });
  return out;
}

export function lineLength(points: readonly { x: number; z: number }[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}

/** Wear lines down where the sea covers them this frame. */
export function erodeLines(lines: readonly SandLine[], waves: WaveClock, t: number, dt: number): void {
  if (dt <= 0) return;
  for (const line of lines) {
    for (const p of line.points) {
      if (p.s <= 0) continue;
      const depth = waves.front(p.x, t) - upBeach(p.x, p.z);
      if (depth <= 0) continue;
      const cover = Math.min(1, depth / 0.35);
      const c = cover * cover * (3 - 2 * cover);
      p.s *= Math.exp(-ERODE_RATE * c * dt);
      line.touched = true;
    }
  }
}

/** Is anything of this line left to see? */
export function isAlive(line: SandLine): boolean {
  return line.points.some((p) => p.s > GONE);
}
