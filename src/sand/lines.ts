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
  /** Lines drawn close together in quick succession (the strokes of a word) share a group. */
  group?: number;
}

/** Strokes this close to, and this soon after, another belong with it. */
const GROUP_GAP = 0.6;
const GROUP_TIME = 5;

/** The group a freshly finished line belongs to: a recent neighbour's, or its own. */
export function groupFor(line: SandLine, lines: readonly SandLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const other = lines[i];
    if (other === line || other.open || line.createdAt - other.createdAt > GROUP_TIME) continue;
    const near = line.points.some((p, k) => k % 3 === 0 && other.points.some((q) => Math.abs(p.x - q.x) < GROUP_GAP && Math.hypot(p.x - q.x, p.z - q.z) < GROUP_GAP));
    if (near) return other.group ?? other.id;
  }
  return line.id;
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

export interface LoopShape {
  closed: boolean;
  cx: number;
  cz: number;
  /** Mean distance from the centre (m). */
  radius: number;
}

/** Is this line a closed loop (a shell, for "Add a crab")? Where is it, and how big? */
export function loopShape(points: readonly { x: number; z: number }[]): LoopShape {
  const n = Math.max(1, points.length);
  let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    cx += p.x / n;
    cz += p.z / n;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  let radius = 0;
  for (const p of points) radius += Math.hypot(p.x - cx, p.z - cz) / n;
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const first = points[0], last = points[points.length - 1];
  const gap = first && last ? Math.hypot(last.x - first.x, last.z - first.z) : Infinity;
  const length = lineLength(points);
  const closed = points.length > 8 && extent > 0.22 && gap < Math.max(0.2, 0.3 * extent) && length > 2.3 * extent;
  return { closed, cx, cz, radius };
}
