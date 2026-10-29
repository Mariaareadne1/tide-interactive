import type { TideApp } from '../app/TideApp';
import type { Selection } from '../state/store';
import { DrawingOverlay } from './DrawingOverlay';
import type { Pt } from './stroke';

/**
 * One pointer state machine for finger, pen and mouse:
 *   press on a crab   → select it; move past a few pixels → carry it
 *   press on the sand → the fingertip goes in; the groove forms under it
 *   press on the sea  → soft rings on the water
 *   press off the tile → a faint line that shivers away (MEADOW's shiver)
 *   "Add a crab" on    → a white line shows the shell being drawn (the sand
 *                        is untouched); a closed loop or a plain tap hatches a crab
 * A second finger, pointercancel or Escape smooths an unfinished line away.
 */

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; sel: NonNullable<Selection>; x: number; y: number; pointerId: number }
  | { kind: 'drag'; pointerId: number }
  | { kind: 'line'; pointerId: number }
  | { kind: 'sea'; pointerId: number; last: Pt; travelled: number }
  | { kind: 'off'; pointerId: number; points: Pt[] }
  | { kind: 'crab'; pointerId: number; points: Pt[] };

const DRAG_THRESHOLD = 4;
/** In "Add a crab", a stroke shorter than this (px) is a tap. */
const TAP_TRAVEL = 10;

/** Roughly closed, on screen: for the faint fill while a shell is drawn. */
function closedish(pts: readonly Pt[]): boolean {
  if (pts.length < 8) return false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, len = 0;
  pts.forEach((p, i) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    if (i) len += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  });
  const extent = Math.max(maxX - minX, maxY - minY);
  const a = pts[0], b = pts[pts.length - 1];
  return extent > 20 && Math.hypot(b.x - a.x, b.y - a.y) < Math.max(14, 0.3 * extent) && len > 2.3 * extent;
}

function travel(pts: readonly Pt[]): number {
  return pts.reduce((m, p) => Math.max(m, Math.hypot(p.x - pts[0].x, p.y - pts[0].y)), 0);
}

export class PointerInput {
  private gesture: Gesture = { kind: 'none' };
  private readonly overlay: DrawingOverlay;
  private readonly activePointers = new Set<number>();
  private hoverRaf = 0;
  private lastHover: Pt | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly el: HTMLElement, private readonly app: TideApp) {
    this.overlay = new DrawingOverlay(el);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
    el.addEventListener('contextmenu', this.noMenu);
    // switching "Add a crab" on or off changes the cursor straight away
    let adding = app.store.get().addingCrab;
    this.unsubscribe = app.store.subscribe(() => {
      if (app.store.get().addingCrab === adding) return;
      adding = app.store.get().addingCrab;
      if (this.lastHover && this.gesture.kind === 'none') this.updateHover(this.lastHover.x, this.lastHover.y);
    });
  }

  /** A line in the sand, or a crab's shell, is being drawn (Esc abandons it). */
  get isDrawing(): boolean {
    return this.gesture.kind === 'line' || this.gesture.kind === 'crab';
  }

  /** Only the canvas itself is touchable; the interface floats above it. */
  private onCanvas(e: Event): boolean {
    return (e.target as Element | null)?.tagName === 'CANVAS';
  }

  private down = (e: PointerEvent) => {
    if (!this.onCanvas(e)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.abort(); // a pinch or a second finger: not a line
      return;
    }
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic); events still arrive on the element
    }
    if (this.app.store.get().addingCrab) {
      this.overlay.begin();
      this.gesture = { kind: 'crab', pointerId: e.pointerId, points: [{ x: e.clientX, y: e.clientY }] };
      return;
    }
    const sel = this.app.pickAt(e.clientX, e.clientY);
    if (sel) {
      this.app.select(sel);
      this.gesture = { kind: 'press', sel, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      this.setCursor('grabbing');
      return;
    }
    const target = this.app.targetAt(e.clientX, e.clientY);
    if (target === 'sand') {
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? 0.55 + e.pressure * 0.6 : 1;
      if (this.app.beginLine(e.clientX, e.clientY, pressure)) {
        this.gesture = { kind: 'line', pointerId: e.pointerId };
        return;
      }
    }
    this.app.select(null);
    if (target === 'sea') {
      this.app.touchSea(e.clientX, e.clientY, 1);
      this.gesture = { kind: 'sea', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY }, travelled: 0 };
      return;
    }
    this.overlay.begin();
    this.gesture = { kind: 'off', pointerId: e.pointerId, points: [{ x: e.clientX, y: e.clientY }] };
  };

  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind === 'none') {
      if (!this.onCanvas(e)) return;
      this.lastHover = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.hover);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = (events.length ? events : [e]).map((c) => ({ x: c.clientX, y: c.clientY }));
    switch (g.kind) {
      case 'press':
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD) {
          this.app.beginDrag(g.sel);
          this.gesture = { kind: 'drag', pointerId: g.pointerId };
          this.app.dragTo(e.clientX, e.clientY);
        }
        return;
      case 'drag':
        this.setCursor(this.app.dragTo(e.clientX, e.clientY) ? 'grabbing' : 'not-allowed');
        return;
      case 'line':
        this.app.extendLine(samples);
        return;
      case 'sea': {
        // a finger trailing through the water leaves a ring every so often
        g.travelled += Math.hypot(e.clientX - g.last.x, e.clientY - g.last.y);
        g.last = { x: e.clientX, y: e.clientY };
        if (g.travelled > 34) {
          g.travelled = 0;
          if (this.app.targetAt(e.clientX, e.clientY) === 'sea') this.app.touchSea(e.clientX, e.clientY, 0.6);
        }
        return;
      }
      case 'off':
        g.points.push(...samples);
        this.overlay.update(g.points, false);
        return;
      case 'crab':
        g.points.push(...samples);
        this.overlay.update(g.points, closedish(g.points));
        return;
    }
  };

  private up = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'none' || g.pointerId !== e.pointerId) return;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') this.app.endDrag();
    else if (g.kind === 'line') this.app.endLine();
    else if (g.kind === 'off') this.overlay.settle(false);
    else if (g.kind === 'crab') {
      const tap = travel(g.points) < TAP_TRAVEL;
      const ok = tap ? this.app.placeCrab(g.points[0].x, g.points[0].y) : this.app.crabFromStroke(g.points);
      if (tap) this.overlay.cancelLive();
      else this.overlay.settle(ok);
    }
    this.updateHover(e.clientX, e.clientY);
  };

  private cancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.abort();
  };

  private lost = (e: PointerEvent) => {
    // capture lost without pointerup (e.g. window blur): treat as cancel
    const g = this.gesture;
    if (g.kind !== 'none' && g.pointerId === e.pointerId && !this.activePointers.has(e.pointerId)) this.abort();
  };

  /** Abandon whatever is in progress. */
  abort(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'line') this.app.abortLine();
    if (g.kind === 'drag') this.app.endDrag();
    if (g.kind === 'off' || g.kind === 'crab') this.overlay.cancelLive();
  }

  private noMenu = (e: Event) => e.preventDefault();

  private hover = () => {
    this.hoverRaf = 0;
    if (this.lastHover) this.updateHover(this.lastHover.x, this.lastHover.y);
  };

  private updateHover(x: number, y: number): void {
    if (this.app.store.get().addingCrab) {
      this.app.hoverSel = null;
      this.setCursor(this.app.crabSpotAt(x, y) ? 'place' : 'not-allowed');
      return;
    }
    const sel = this.app.pickAt(x, y);
    this.app.hoverSel = sel;
    if (sel) this.setCursor('grab');
    else this.setCursor(this.app.targetAt(x, y) === 'sand' ? 'draw' : 'default');
  }

  private setCursor(c: 'grab' | 'grabbing' | 'draw' | 'place' | 'default' | 'not-allowed'): void {
    this.el.dataset.cursor = c;
  }

  dispose(): void {
    cancelAnimationFrame(this.hoverRaf);
    this.unsubscribe();
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('lostpointercapture', this.lost);
    this.el.removeEventListener('contextmenu', this.noMenu);
    this.overlay.dispose();
  }
}
