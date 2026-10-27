import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store, Selection } from '../state/store';
import { Cove } from '../scene/Cove';
import { baseWetness, isDrawable, surfaceAt, terrainHeight } from '../scene/beach';
import { screenToTerrain } from '../interaction/terrainRay';
import { erodeLines, groupFor, isAlive, lineLength, loopShape, resample, type SandLine } from '../sand/lines';
import type { Segment } from '../sand/SandField';
import { Beach, MAX_CRABS } from '../crabs/Beach';
import { Sound } from '../audio/Sound';
import { SONG_SECONDS } from '../crabs/dance';
import { CRAB_SCALE } from '../crabs/anatomy';

/**
 * Application commands. Pointer input and the interface call these; they
 * press lines into the sand, smooth the last one back over, and pass
 * requests on to the crabs. Nothing is saved: the sea takes the lines, and
 * a reload brings back a smooth beach.
 */

/** Spacing of a line's points along the sand (world m). */
const SPACING = 0.02;
/** How much each new pointer sample is trusted: lower is smoother, laggier. */
const FOLLOW = 0.6;

export type DrawTarget = 'sand' | 'sea' | 'off';

interface Pen {
  line: SandLine;
  /** Smoothed fingertip position (world). */
  sx: number;
  sz: number;
  /** The last point stamped (world). */
  last: { x: number; z: number } | null;
}

export class TideApp {
  readonly cove: Cove;
  readonly beach: Beach;
  readonly lines: SandLine[] = [];
  readonly sound = new Sound();
  /** How far the fingertip moved through the sand since the last frame (m). */
  private drawn = 0;
  private drawWet = 0;
  private pen: Pen | null = null;
  private nextLineId = 1;
  private drag: { id: number } | null = null;
  private readonly unsub: (() => void)[] = [];
  hoverSel: Selection = null;

  constructor(readonly engine: Engine, readonly store: Store) {
    this.cove = new Cove(engine);
    this.beach = new Beach(engine, this.cove.waves, { stamp: (segs) => this.cove.sand.stamp(segs) });
    engine.scene.add(this.beach.group);
  }

  start(): void {
    this.unsub.push(
      this.engine.onFrame((dt, t) => {
        erodeLines(this.lines, this.cove.waves, t, dt);
        this.forgetTakenLines();
        this.cove.update(dt, t);
        this.beach.update(dt, t, this.lines);
        const sel = this.store.get().selection;
        this.beach.setHighlight(sel?.id ?? null, this.hoverSel?.id ?? null);
        const w = this.cove.waves.at(t);
        const tau = this.cove.waves.tau(t);
        this.sound.update({ tau, reach: w ? w.reach : 1 }, dt > 0 ? this.drawn / dt : 0, this.drawWet);
        this.drawn = 0;
      }),
    );
    this.beach.onModeChange = () => this.store.set({ crabTick: this.store.get().crabTick + 1, crabCount: this.beach.crabs.length });
    this.beach.onPuff = (kind) => (kind === 'dig' ? this.sound.dig() : this.sound.pop());
    this.store.set({ soundOn: this.sound.enabled });
    this.store.set({ loading: false });
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  // --- drawing ---------------------------------------------------------------

  /** What a press at this point would touch. */
  targetAt(clientX: number, clientY: number): DrawTarget {
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (!hit) return 'off';
    const s = surfaceAt(hit.x, hit.z);
    if (s === 'sea') return 'sea';
    return isDrawable(s) ? 'sand' : 'off';
  }

  /** A fingertip goes into the sand. Returns false if there is no sand under it. */
  beginLine(clientX: number, clientY: number, pressure = 1): boolean {
    this.endLine();
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (!hit || !isDrawable(surfaceAt(hit.x, hit.z))) return false;
    const line: SandLine = { id: this.nextLineId++, points: [], pressure: Math.min(1, Math.max(0.55, pressure)), createdAt: this.engine.elapsed, touched: false, open: true };
    this.cove.sand.snapshot(this.engine.renderer, line.id);
    this.lines.push(line);
    this.pen = { line, sx: hit.x, sz: hit.z, last: null };
    this.press(hit.x, hit.z);
    this.store.set({ selection: null });
    return true;
  }

  /** The fingertip moves: the groove forms under it as it goes. */
  extendLine(points: readonly { x: number; y: number }[]): void {
    const pen = this.pen;
    if (!pen) return;
    for (const p of points) {
      const hit = screenToTerrain(this.engine.camera, this.rect, p.x, p.y);
      if (!hit) continue;
      pen.sx += (hit.x - pen.sx) * FOLLOW;
      pen.sz += (hit.z - pen.sz) * FOLLOW;
      this.press(pen.sx, pen.sz);
    }
  }

  /** Press the smoothed fingertip into the sand, resampled so the groove is even. */
  private press(x: number, z: number): void {
    const pen = this.pen!;
    if (!isDrawable(surfaceAt(x, z))) {
      // the finger left the sand (into the sea, onto a rock): lift until it comes back
      pen.last = null;
      return;
    }
    const segs: Segment[] = [];
    const pressure = pen.line.pressure;
    if (!pen.last) {
      pen.last = { x, z };
      pen.line.points.push({ x, z, s: 1 });
      segs.push({ ax: x, az: z, bx: x, bz: z, pressure });
    } else {
      if (Math.hypot(x - pen.last.x, z - pen.last.z) < SPACING) return;
      this.drawn += Math.hypot(x - pen.last.x, z - pen.last.z);
      this.drawWet = baseWetness(x, z);
      const pts = resample([pen.last, { x, z }], SPACING).slice(1);
      let a = pen.last;
      for (const b of pts) {
        segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, pressure });
        pen.line.points.push({ x: b.x, z: b.z, s: 1 });
        a = b;
      }
      pen.last = a;
    }
    this.cove.sand.stamp(segs);
  }

  /** The fingertip lifts. Crabs come to see lines long enough to walk. */
  endLine(): SandLine | null {
    const pen = this.pen;
    if (!pen) return null;
    this.pen = null;
    pen.line.open = false;
    if (pen.line.points.length === 0) {
      this.lines.splice(this.lines.indexOf(pen.line), 1);
      this.cove.sand.dropSnapshot(pen.line.id);
      return null;
    }
    if (this.store.get().addingCrab && this.hatchFrom(pen.line)) return pen.line;
    pen.line.group = groupFor(pen.line, this.lines);
    this.store.set({ hasDrawn: true });
    this.refreshUndo();
    if (lineLength(pen.line.points) > 0.35) this.beach.notice(pen.line);
    return pen.line;
  }

  get drawing(): boolean {
    return this.pen !== null;
  }

  /**
   * "Add a crab": a closed shape drawn in the sand is a shell. The groove
   * smooths away as a crab, sized to the drawing, digs its way out of it.
   */
  private hatchFrom(line: SandLine): boolean {
    const shape = loopShape(line.points);
    if (!shape.closed) {
      this.store.toast('Close the loop to draw a shell — that one stays a line.');
      return false;
    }
    // the base crab's shell is ~0.3 m across the middle at the app's scale
    const size = Math.min(1.5, Math.max(0.7, shape.radius / (0.17 * CRAB_SCALE)));
    const crab = this.beach.hatch(shape.cx, shape.cz, size);
    if (!crab) {
      this.store.toast('The beach has all the crabs it can hold.');
      this.store.set({ addingCrab: false });
      return false;
    }
    this.undo(line.id);
    this.store.set({ addingCrab: false, hasDrawn: true, crabCount: this.beach.crabs.length, selection: null });
    return true;
  }

  toggleAddCrab(): void {
    if (this.beach.crabs.length >= MAX_CRABS) {
      this.store.toast('The beach has all the crabs it can hold.');
      return;
    }
    this.store.set({ addingCrab: !this.store.get().addingCrab, selection: null });
  }

  /** Everyone on the beach lines up and dances to a song. */
  dance(): void {
    this.sound.unlock();
    const start = this.beach.dance();
    this.sound.song(start - this.engine.elapsed, SONG_SECONDS);
  }

  setSound(on: boolean): void {
    this.sound.unlock();
    this.sound.setEnabled(on);
    this.store.set({ soundOn: on });
  }

  /** Abandon the line in progress (a second finger, Escape): the sand smooths back over it. */
  abortLine(): void {
    const line = this.endLine();
    if (line) this.undo(line.id);
  }

  /** A press on the water: a soft ring. */
  touchSea(clientX: number, clientY: number, strength = 1): void {
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (hit) this.cove.ripple(hit.x, hit.z, strength);
  }

  /** Lines the sea has reached can no longer be undone; lines it has taken are forgotten. */
  private forgetTakenLines(): void {
    let changed = false;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      if (line.open) continue;
      if (line.touched && this.cove.sand.hasSnapshot(line.id)) {
        this.cove.sand.dropSnapshot(line.id);
        changed = true;
      }
      if (!isAlive(line)) {
        this.lines.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.refreshUndo();
  }

  private refreshUndo(): void {
    const undoable = this.lines.filter((l) => !l.open && !l.touched && this.cove.sand.hasSnapshot(l.id)).length;
    if (undoable !== this.store.get().undoable) this.store.set({ undoable });
  }

  /** Smooth the last line back over — unless the sea already has it. */
  undo(lineId?: number): boolean {
    const line = lineId !== undefined ? this.lines.find((l) => l.id === lineId) : [...this.lines].reverse().find((l) => !l.open);
    if (!line) return false;
    if (line.touched || !this.cove.sand.hasSnapshot(line.id)) {
      if (lineId === undefined) this.store.toast('The sea already has that one.');
      return false;
    }
    const segs: Segment[] = [];
    for (let i = 0; i < line.points.length; i++) {
      const a = line.points[Math.max(0, i - 1)], b = line.points[i];
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, pressure: 1 });
    }
    this.cove.sand.undo(this.engine.renderer, line.id, segs);
    this.lines.splice(this.lines.indexOf(line), 1);
    this.beach.forget(line.id);
    this.refreshUndo();
    return true;
  }

  // --- crabs -----------------------------------------------------------------

  pickAt(clientX: number, clientY: number): Selection {
    const id = this.beach.pick(clientX, clientY, this.engine.camera, this.rect, (p) => this.engine.pixelsPerMeterAt(p));
    return id === null ? null : { kind: 'crab', id };
  }

  select(sel: Selection): void {
    const cur = this.store.get().selection;
    if (cur?.id !== sel?.id) this.store.set({ selection: sel });
  }

  selectionCentre(sel: Selection): THREE.Vector3 | null {
    if (!sel) return null;
    return this.beach.get(sel.id)?.centre(new THREE.Vector3()) ?? null;
  }

  beginDrag(sel: Selection): void {
    if (!sel) return;
    this.drag = { id: sel.id };
    this.beach.get(sel.id)?.controller.grab();
  }

  dragTo(clientX: number, clientY: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (!hit) return false;
    return this.beach.get(d.id)?.controller.dragTo(hit.x, hit.z) ?? false;
  }

  endDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.beach.get(d.id)?.controller.release(this.engine.elapsed);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  followLine(id: number): void {
    const ok = this.beach.followLine(id, this.lines);
    if (!ok) this.store.toast('Draw a line and it will follow it.');
  }

  waveClaws(id: number): void {
    this.beach.get(id)?.controller.waveClaws(this.engine.elapsed);
  }

  toggleBurrow(id: number): void {
    this.beach.get(id)?.controller.toggleBurrow(this.engine.elapsed);
  }

  /** Smooth sand again (after the graphics context is restored). */
  resetSand(): void {
    this.pen = null;
    this.lines.length = 0;
    this.cove.sand.invalidate();
    this.beach.forgetAll();
    this.refreshUndo();
  }

  /** Wetness of the sand at a point (for tests and the crabs). */
  wetnessAt(x: number, z: number): number {
    return baseWetness(x, z);
  }

  heightAt(x: number, z: number): number {
    return terrainHeight(x, z);
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.beach.dispose();
    this.cove.dispose();
    this.sound.dispose();
  }
}
