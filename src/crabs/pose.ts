/**
 * A crab's pose is a flat record of numbers (radians, metres, 0..1 amounts),
 * so blending any two behaviours is a per-key lerp. Behaviours are pure
 * functions of time that return one (MEADOW's and POND's pattern).
 */

export const CRAB_KEYS = [
  'gait', // leg-cycle amplitude 0..1 (the cycle's phase is continuous, never blended)
  'bob', // body lift (m)
  'squash', // + squash, - stretch
  'roll',
  'pitch',
  'clawL', // arm raised 0..1
  'clawR',
  'pinchL', // pincer open 0..1
  'pinchR',
  'eyes', // stalks up 0..1.2
  'look', // eye yaw (rad)
  'burrow', // 0 standing .. 1 under the sand with only eyes showing
  'dig', // legs scrabbling at the sand 0..1
] as const;

export type CrabKey = (typeof CRAB_KEYS)[number];
export type Pose = Record<CrabKey, number>;

export function emptyPose(): Pose {
  const p = {} as Pose;
  for (const k of CRAB_KEYS) p[k] = 0;
  return p;
}

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const k of CRAB_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function isFinitePose(p: Pose): boolean {
  return CRAB_KEYS.every((k) => Number.isFinite(p[k]));
}

// --- small shared helpers for pure, time-based behaviours ----------------------

export const TAU = Math.PI * 2;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 before a, eases to 1 at b. */
export const ramp = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));
/** Rises a..b, holds, falls c..d. */
export const window4 = (t: number, a: number, b: number, c: number, d: number) => ramp(t, a, b) * (1 - ramp(t, c, d));

export const hashf = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Short events (eye twitches, claw snaps) at irregular but deterministic times. */
export function pulse(t: number, seed: number, period: number, width: number, lane: number): number {
  const i = Math.floor(t / period);
  let v = 0;
  for (const k of [i - 1, i, i + 1]) {
    const at = (k + 0.15 + hashf(k + seed * 7.1 + lane) * 0.7) * period;
    if (hashf(k * 3.3 + seed + lane * 9.9) < 0.75) v = Math.max(v, Math.exp(-(((t - at) / width) ** 2)));
  }
  return v;
}

/** Damped oscillation from an impulse at t = 0 (a bob, a wobble). */
export const ring = (t: number, freq: number, decay: number) => (t < 0 ? 0 : Math.sin(t * freq) * Math.exp(-t * decay));
