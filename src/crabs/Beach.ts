import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { WaveClock } from '../sea/waves';
import { isAlive, lineLength, type SandLine } from '../sand/lines';
import { CrabController, type CrabSpec, type CrabWorld } from './CrabController';
import { CRAB_COLOURS, CrabView } from './CrabView';
import { CRAB_SCALE } from './anatomy';
import { buildPath, longestRun, nearestOnPath } from './path';
import { Puffs } from './Puffs';
import { danceSlots, SONG_SECONDS } from './dance';
import { isDrawable, surfaceAt } from '../scene/beach';
import type { Segment } from '../sand/SandField';

/**
 * The beach's four crabs, each a controller (where it goes, what it does)
 * and a view (its painted body). When a line is finished, the nearest free
 * crab scuttles over to walk along it, and on a long line a second one may
 * come and watch.
 */

/** No more crabs than this on one beach (the four who live here and up to six drawn ones). */
export const MAX_CRABS = 10;

/** Marks crabs leave in the sand. */
export interface SandMarks {
  stamp(segments: Segment[]): void;
}

/** Where each crab lives: two on the wet sand, one up by the dry sand, one near the high-water mark. */
export const CRAB_HOMES: readonly CrabSpec[] = [
  { id: 1, seed: 1, home: { x: -3.4, z: 1.7 }, burrowiness: 0.7 },
  { id: 2, seed: 2, home: { x: 2.9, z: -0.4 }, burrowiness: 0.2 },
  { id: 3, seed: 3, home: { x: 6.0, z: 1.3 }, burrowiness: 0.55 },
  { id: 4, seed: 4, home: { x: -6.4, z: -1.6 }, burrowiness: 0.1 },
];

export interface Crab {
  readonly id: number;
  readonly controller: CrabController;
  readonly view: CrabView;
  centre(target: THREE.Vector3): THREE.Vector3;
}

export class Beach {
  readonly group = new THREE.Group();
  readonly crabs: Crab[];
  readonly puffs = new Puffs();
  onModeChange: (() => void) | null = null;
  /** A crab dug in, or popped out (for sound). */
  onPuff: ((kind: 'dig' | 'pop') => void) | null = null;
  /** When the current dance's song starts (engine seconds), or null. */
  danceStart: number | null = null;
  /** Footprints and hollows pressed so far, and the latest (for tests). */
  marksMade = 0;
  lastMark: { x: number; z: number } | null = null;
  private lines: readonly SandLine[] = [];
  private readonly world: CrabWorld;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly engine: Engine, waves: WaveClock, private readonly marks: SandMarks | null = null) {
    this.group.name = 'crabs';
    this.crabs = CRAB_HOMES.map((spec) => this.make({ ...spec, home: { ...spec.home } }));
    this.group.add(this.puffs.points);
    this.world = {
      waves,
      line: (id) => this.lines.find((l) => l.id === id),
      others: (id) => this.crabs.filter((c) => c.id !== id).map((c) => ({ x: c.controller.x, z: c.controller.z })),
    };
  }

  private make(spec: CrabSpec): Crab {
    const controller = new CrabController(spec);
    const size = spec.size ?? 1;
    const view = new CrabView(this.engine.world, CRAB_COLOURS[(spec.id - 1) % CRAB_COLOURS.length], spec.seed, size);
    this.group.add(view.root);
    controller.onModeChange = () => this.onModeChange?.();
    controller.onPuff = (x, z, s) => {
      this.puffs.burst(x, z, s * size);
      this.onPuff?.(s >= 1 ? 'dig' : 'pop');
      // digging in or popping out leaves a little hollow
      this.mark([{ ax: x, az: z, bx: x, bz: z, pressure: 0.42, width: 1.6 * size }]);
    };
    controller.onStep = (feet) => this.mark(feet.map((f) => ({ ax: f.x, az: f.z, bx: f.x, bz: f.z, pressure: 0.5, width: 0.34 * size })));
    return {
      id: spec.id,
      controller,
      view,
      centre: (target: THREE.Vector3) => target.set(controller.x, view.root.position.y + view.body.position.y * CRAB_SCALE * size, controller.z),
    };
  }

  /** Press marks into the sand (never into the sea, rocks or dunes). */
  private mark(segs: Segment[]): void {
    const on = segs.filter((s) => isDrawable(surfaceAt(s.ax, s.az)));
    if (!on.length) return;
    this.marks?.stamp(on);
    this.marksMade += on.length;
    this.lastMark = { x: on[on.length - 1].ax, z: on[on.length - 1].az };
  }

  /** A shell drawn in the sand comes to life: a new crab digs its way out there. */
  hatch(x: number, z: number, size: number): Crab | null {
    if (this.crabs.length >= MAX_CRABS) return null;
    const id = Math.max(...this.crabs.map((c) => c.id)) + 1;
    const crab = this.make({ id, seed: id * 3 + 1, home: { x, z }, burrowiness: ((id * 0.618) % 1) * 0.8, size });
    this.crabs.push(crab);
    crab.controller.hatch(this.engine.elapsed);
    this.puffs.burst(x, z, 1.4 * size);
    this.onModeChange?.();
    return crab;
  }

  get dancing(): boolean {
    return this.danceStart !== null && this.engine.elapsed < this.danceStart + SONG_SECONDS;
  }

  /**
   * Everyone line up! Each crab takes a place in a row along the shore
   * (left to right as they stand, so nobody crosses), and the song starts
   * once the farthest has had time to scuttle over. Returns the start time.
   */
  dance(): number {
    const t = this.engine.elapsed;
    const dancers = this.crabs.filter((c) => c.controller.mode !== 'held').sort((a, b) => a.controller.x - b.controller.x);
    const slots = danceSlots(dancers.length);
    const far = Math.max(0, ...dancers.map((c, i) => Math.hypot(slots[i].x - c.controller.x, slots[i].z - c.controller.z)));
    const start = t + Math.min(6, Math.max(1.8, far / 0.95 + 1.1));
    dancers.forEach((c, i) => c.controller.dance(t, slots[i], i, dancers.length, start));
    this.danceStart = start;
    this.onModeChange?.();
    return start;
  }

  get(id: number): Crab | undefined {
    return this.crabs.find((c) => c.id === id);
  }

  update(dt: number, t: number, lines: readonly SandLine[]): void {
    this.lines = lines;
    for (const c of this.crabs) {
      c.controller.update(dt, t, this.world);
      const k = c.controller;
      c.view.apply(k.x, k.z, k.heading, k.phase, k.pose, t);
    }
    this.puffs.update(dt);
  }

  /** A line was just finished: the nearest free crab comes to walk it; on a long line, another may come to watch. */
  notice(line: SandLine): void {
    const t = this.engine.elapsed;
    const path = buildPath(longestRun(line.points));
    if (!path) return;
    // the strokes of one word are one thing to look at: if a crab already has it, let it be
    const group = line.group ?? line.id;
    const taken = this.crabs.some((c) => {
      const id = c.controller.lineId;
      const other = id !== null ? this.lines.find((l) => l.id === id) : undefined;
      return other !== undefined && other.id !== line.id && (other.group ?? other.id) === group;
    });
    const waiting = this.crabs.find((c) => c.controller.waitingForLine);
    if (taken && !waiting) return;
    const free = this.crabs.filter((c) => c.controller.available || c.controller.waitingForLine);
    if (!free.length) return;
    const dist = (c: Crab) => nearestOnPath(path, c.controller.x, c.controller.z).d;
    const sorted = [...free].sort((a, b) => dist(a) - dist(b));
    const walker = waiting ?? sorted[0];
    walker.controller.goFollow(line, t);
    const second = sorted.find((c) => c !== walker && c.controller.available);
    if (second && lineLength(line.points) > 1.2 && dist(second) < 5 && (line.id * 0.618) % 1 < 0.6) second.controller.goWatch(line, t);
  }

  /** "Follow a line": the nearest line that is left (or, with none, the next one drawn). */
  followLine(id: number, lines: readonly SandLine[]): boolean {
    const crab = this.get(id);
    if (!crab) return false;
    const k = crab.controller;
    let best: SandLine | null = null, bd = Infinity;
    for (const line of lines) {
      if (line.open || !isAlive(line)) continue;
      const path = buildPath(longestRun(line.points));
      if (!path) continue;
      const d = nearestOnPath(path, k.x, k.z).d;
      if (d < bd) {
        bd = d;
        best = line;
      }
    }
    if (best) return k.goFollow(best, this.engine.elapsed);
    k.waitingForLine = true;
    this.onModeChange?.();
    return false;
  }

  /** A line was undone: crabs heading for it lose interest. */
  forget(lineId: number): void {
    void lineId; // controllers drop lines that no longer exist on their next frame
  }

  forgetAll(): void {
    this.lines = [];
  }

  setHighlight(selected: number | null, hover: number | null): void {
    for (const c of this.crabs) c.view.setHighlight(c.id === selected ? 1 : c.id === hover ? 0.45 : 0);
  }

  /** The crab under the pointer: generous, since crabs are small and often moving. */
  pick(clientX: number, clientY: number, camera: THREE.Camera, rect: DOMRect, ppm: (p: THREE.Vector3) => number): number | null {
    let best: number | null = null, bd = Infinity;
    for (const c of this.crabs) {
      const p = c.centre(this.tmp);
      const radius = Math.max(16, ppm(p) * 0.3);
      p.project(camera);
      const sx = rect.left + ((p.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - p.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < radius && d < bd) {
        bd = d;
        best = c.id;
      }
    }
    return best;
  }

  dispose(): void {
    for (const c of this.crabs) c.view.dispose();
    this.puffs.dispose();
  }
}
