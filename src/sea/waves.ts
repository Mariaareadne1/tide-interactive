/**
 * The sea's rhythm, as a pure function of time and seed: one wave every
 * 5–8 s, most reaching partway up the wet sand, every fourth or fifth one
 * running much higher — sometimes onto the dry sand. Nothing here keeps
 * state that changes the answer; the schedule is only memoised so that
 * asking "which wave is it at t?" stays cheap. Recordings and tests replay
 * exactly.
 *
 * Distances are measured up the beach from the mean waterline (see
 * `upBeach` in scene/beach.ts).
 */

export interface Wave {
  readonly index: number;
  readonly start: number;
  readonly duration: number;
  /** How far up the beach this wave's front runs at its peak (m). */
  readonly reach: number;
  readonly big: boolean;
  /** Phases for the front's lateral wobble, so no two waves have the same edge. */
  readonly phaseA: number;
  readonly phaseB: number;
}

export interface WaveOptions {
  seed?: number;
  /** Slower, gentler sea (reduced motion): stretches every interval. */
  tempo?: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Fraction of a wave's reach covered at local time tau (0..1): run up, pause, draw back, rest. */
export function frontProfile(tau: number): number {
  if (tau <= 0 || tau >= 1) return 0;
  if (tau < 0.3) return easeOut(tau / 0.3);
  if (tau < 0.4) return 1 - 0.03 * ((tau - 0.3) / 0.1);
  if (tau < 0.9) return 0.97 * (1 - easeInOut((tau - 0.4) / 0.5));
  return 0;
}

/** True while the water is running up (and the brief pause at the top). */
export function isRunningUp(tau: number): boolean {
  return tau > 0 && tau < 0.4;
}

/** Lateral wobble of the front: the same expression is used in GLSL. */
export function frontWobble(x: number, phaseA: number, phaseB: number): number {
  return 1 + 0.1 * Math.sin(x * 0.55 + phaseA) + 0.06 * Math.sin(x * 1.3 + phaseB);
}

export class WaveClock {
  readonly seed: number;
  readonly tempo: number;
  private readonly waves: Wave[] = [];
  /** Indices of the big waves, generated alongside the schedule. */
  private nextBig: number;
  private bigCount = 0;
  /** Shifts the whole schedule in time (scripted demos line a big wave up with a moment). */
  offset = 0;

  constructor(options: WaveOptions = {}) {
    this.seed = options.seed ?? 1;
    this.tempo = options.tempo ?? 1;
    this.nextBig = 3;
  }

  private build(index: number): void {
    while (this.waves.length <= index) {
      const k = this.waves.length;
      const s = this.seed * 13.37 + k;
      const big = k === this.nextBig;
      if (big) {
        // every fourth or fifth wave runs high
        this.bigCount++;
        this.nextBig = k + (hash(this.seed * 3.1 + this.bigCount) < 0.5 ? 4 : 5);
      }
      const interval = (big ? 8.2 + 1.2 * hash(s + 0.5) : 5 + 3 * hash(s + 0.25)) * this.tempo;
      const reach = big ? 3.7 + 1.6 * hash(s + 0.75) : 0.9 + 1.4 * hash(s + 0.9);
      const prev = this.waves[k - 1];
      this.waves.push({
        index: k,
        start: prev ? prev.start + prev.duration : 0.6,
        duration: interval,
        reach,
        big,
        phaseA: hash(s + 1.1) * 6.283,
        phaseB: hash(s + 1.7) * 6.283,
      });
    }
  }

  wave(index: number): Wave {
    this.build(index);
    return this.waves[index];
  }

  /** The wave whose cycle contains time t (null before the first one). */
  at(t: number): Wave | null {
    const time = t + this.offset;
    this.build(0);
    if (time < this.waves[0].start) return null;
    // the schedule is monotonic: grow it until it passes t, then bisect
    while (this.waves[this.waves.length - 1].start + this.waves[this.waves.length - 1].duration <= time) this.build(this.waves.length);
    let lo = 0, hi = this.waves.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.waves[mid].start <= time) lo = mid;
      else hi = mid - 1;
    }
    return this.waves[lo];
  }

  /** Local phase 0..1 within the current wave. */
  tau(t: number): number {
    const w = this.at(t);
    return w ? (t + this.offset - w.start) / w.duration : 0;
  }

  /** How far up the beach the water reaches at x and time t (m; 0 = mean waterline). */
  front(x: number, t: number): number {
    const w = this.at(t);
    if (!w) return 0;
    const tau = (t + this.offset - w.start) / w.duration;
    return w.reach * frontProfile(tau) * frontWobble(x, w.phaseA, w.phaseB);
  }

  /** Is the point u (m up the beach) under water at time t? */
  covered(x: number, u: number, t: number): boolean {
    return u < this.front(x, t);
  }

  /** The next big wave starting at or after t. */
  nextBigAfter(t: number): Wave {
    for (let k = 0; ; k++) {
      const w = this.wave(k);
      if (w.big && w.start >= t + this.offset) return w;
    }
  }

  /** Line the schedule up so the next big wave starts `inSeconds` after t. */
  scheduleBig(t: number, inSeconds: number): void {
    const w = this.nextBigAfter(t + 2);
    this.offset = w.start - (t + inSeconds);
  }
}
