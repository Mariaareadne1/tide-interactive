import { isWalkable, shoreZ } from '../scene/beach';
import { emptyPose, smooth, clamp01, type Pose } from './pose';

/**
 * The beach's little dance: every crab lines up along the shore, facing
 * you, and they dance to a calypso together. The choreography is a pure
 * function of the beat (and each crab's place in the row), so the crabs
 * stay in step with each other and with the song, which is scheduled from
 * the same numbers (see audio/song.ts).
 */

export const BPM = 112;
export const BEAT = 60 / BPM;
/** A bar of claw-tapping to count in. */
export const INTRO_BEATS = 4;
/** Eight bars of dancing. */
export const DANCE_BEATS = 32;
/** The last chord rings for two more beats while they hold the final pose. */
export const OUTRO_BEATS = 2;
export const SONG_BEATS = INTRO_BEATS + DANCE_BEATS + OUTRO_BEATS;
export const SONG_SECONDS = SONG_BEATS * BEAT;

/** How far up the beach the row stands (m): above the reach of ordinary waves (≤ 2.3 m, ×1.16 at the wobble's peak). */
export const ROW_U = 3.15;

/** Places in the row for n crabs: along the shoreline, centred on the cove. */
export function danceSlots(n: number): { x: number; z: number }[] {
  const spacing = Math.min(1.3, 14 / Math.max(1, n));
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    let x = (i - (n - 1) / 2) * spacing;
    let z = shoreZ(x) - ROW_U;
    // never into the rocks or off the paint
    for (let k = 0; k < 20 && !isWalkable(x, z); k++) {
      x *= 0.95;
      z = shoreZ(x) - ROW_U;
    }
    out.push({ x, z });
  }
  return out;
}

/** The row's direction at x (a unit vector along the shoreline). */
export function rowTangent(x: number): { x: number; z: number } {
  const dz = (shoreZ(x + 0.05) - shoreZ(x - 0.05)) / 0.1;
  const len = Math.hypot(1, dz);
  return { x: 1 / len, z: dz / len };
}

/** A sharp accent on every beat that decays before the next. */
const onBeat = (b: number) => Math.exp(-((b - Math.floor(b)) * 5));
const bump = (t: number) => (t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0);

export interface DanceFrame {
  /** Step along the row (m). */
  along: number;
  /** Hop off the ground (m). */
  hop: number;
  /** Turn added to facing the camera (rad). */
  spin: number;
  pose: Pose;
}

/**
 * Where a crab is in the dance at beat `b` (0 = the song starts), standing
 * in place `slot` of `n`.
 */
export function danceFrame(b: number, slot: number, n: number): DanceFrame {
  const p = emptyPose();
  p.eyes = 1.15;
  let along = 0, hop = 0, spin = 0;
  const beatAcc = onBeat(b);
  if (b < INTRO_BEATS) {
    // counting in: a claw taps the sand on every beat
    p.clawR = 0.4 - 0.3 * beatAcc;
    p.pinchR = 0.6 * beatAcc;
    p.clawL = 0.2;
    p.bob = 0.008 * beatAcc;
    p.look = 0.3 * Math.sin(b * 0.8 + slot);
    return { along, hop, spin, pose: p };
  }
  const d = b - INTRO_BEATS;
  const bar = Math.floor(d / 4);
  const bb = d - bar * 4;
  switch (bar) {
    case 0:
    case 1: {
      // side-step: two beats to one side, two to the other, claws pumping
      along = 0.17 * Math.sin((Math.PI * d) / 2);
      p.gait = Math.abs(Math.cos((Math.PI * d) / 2));
      p.clawL = p.clawR = 0.45 + 0.25 * beatAcc;
      p.pinchL = p.pinchR = 0.5 * beatAcc;
      p.bob = 0.01 * beatAcc;
      p.roll = -0.12 * Math.cos((Math.PI * d) / 2);
      break;
    }
    case 2: {
      // claws up and waving, a bounce on every beat
      p.clawL = 0.9 + 0.15 * Math.sin(d * Math.PI);
      p.clawR = 0.9 - 0.15 * Math.sin(d * Math.PI);
      p.pinchL = p.pinchR = 0.5 + 0.5 * Math.sin(d * Math.PI * 2);
      p.squash = 0.12 * beatAcc - 0.05;
      p.bob = 0.015 * (1 - beatAcc);
      p.roll = 0.15 * Math.sin(d * Math.PI);
      break;
    }
    case 3: {
      // a ripple down the line: each crab hops in turn, claws flung up
      const at = (slot / Math.max(1, n - 1)) * 2.5;
      const h = bump((bb - at) / 0.9);
      hop = 0.09 * h;
      p.squash = -0.14 * h + 0.1 * bump((bb - at - 0.9) / 0.4);
      p.clawL = p.clawR = 0.3 + 0.7 * h;
      p.pinchL = p.pinchR = h;
      p.gait = 0.6 * h;
      break;
    }
    case 4: {
      // a spin on the spot
      spin = Math.PI * 2 * smooth(clamp01(bb / 3.5));
      p.gait = 1 - Math.abs(bb / 3.5 - 0.5) * 2 > 0 ? 0.9 : 0;
      p.clawL = p.clawR = 0.6;
      p.squash = 0.06 * beatAcc;
      p.bob = 0.01;
      break;
    }
    case 5: {
      // shimmy: a quick wiggle on the eighths, pincers snapping
      p.roll = 0.2 * Math.sin(d * Math.PI * 4);
      p.pitch = 0.08 * Math.sin(d * Math.PI * 2);
      p.clawL = 0.55 + 0.1 * Math.sin(d * Math.PI * 4);
      p.clawR = 0.55 - 0.1 * Math.sin(d * Math.PI * 4);
      p.pinchL = p.pinchR = 0.5 + 0.5 * Math.sin(d * Math.PI * 4);
      p.bob = -0.004;
      p.dig = 0.25;
      break;
    }
    case 6: {
      // side-step the other way, twice as quick
      along = -0.2 * Math.sin(Math.PI * d);
      p.gait = Math.abs(Math.cos(Math.PI * d));
      p.clawL = p.clawR = 0.5 + 0.3 * beatAcc;
      p.bob = 0.012 * beatAcc;
      p.roll = 0.14 * Math.cos(Math.PI * d);
      break;
    }
    default: {
      // the finish: a gather, then claws high — ta-da — and hold
      const up = smooth(clamp01((bb - 2) / 0.5));
      p.clawL = p.clawR = 0.35 + 0.75 * up;
      p.pinchL = p.pinchR = up;
      p.squash = 0.1 * smooth(clamp01(bb / 2)) * (1 - up) - 0.1 * up;
      p.bob = 0.02 * up;
      p.eyes = 1.15 + 0.1 * up;
      break;
    }
  }
  return { along, hop, spin, pose: p };
}
