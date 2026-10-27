import { emptyPose, pulse, ramp, ring, window4, type Pose } from './pose';

/**
 * What a crab does, as pure functions of the time since the behaviour began
 * (and the crab's seed). The controller picks one and cross-fades between
 * them; nothing here keeps state.
 */

export type BehaviourName = 'idle' | 'walk' | 'look' | 'wave' | 'dig' | 'burrow' | 'buried' | 'emerge' | 'held';

/** How long a one-shot behaviour lasts (s); Infinity for ones that loop. */
export const DURATION: Record<BehaviourName, number> = {
  idle: Infinity,
  walk: Infinity,
  look: Infinity,
  wave: 2.4,
  dig: 2.2,
  burrow: 1.5,
  buried: Infinity,
  emerge: 0.8,
  held: Infinity,
};

function breathe(p: Pose, t: number, seed: number): void {
  p.bob = 0.004 * Math.sin(t * 2.1 + seed);
  p.eyes = 1 - 0.7 * pulse(t, seed, 3.2, 0.09, 1); // the stalks flick down now and then (a blink)
  p.look = 0.35 * Math.sin(t * 0.7 + seed * 2) + 0.3 * (pulse(t, seed, 2.6, 0.4, 2) - pulse(t, seed, 3.7, 0.4, 3));
  p.pinchL = 0.15 + 0.6 * pulse(t, seed, 2.3, 0.12, 4);
  p.pinchR = 0.15 + 0.6 * pulse(t, seed, 2.9, 0.12, 5);
  p.clawL = 0.12 + 0.05 * Math.sin(t * 1.3 + seed);
  p.clawR = 0.12 + 0.05 * Math.sin(t * 1.1 + seed + 1);
}

const behaviours: Record<BehaviourName, (t: number, seed: number) => Pose> = {
  idle(t, seed) {
    const p = emptyPose();
    breathe(p, t, seed);
    return p;
  },

  walk(t, seed) {
    const p = emptyPose();
    p.gait = 1;
    p.bob = 0.006 + 0.004 * Math.sin(t * 22);
    p.squash = 0.03 * Math.sin(t * 22 + 1);
    p.roll = 0.05 * Math.sin(t * 11 + seed);
    p.clawL = 0.3;
    p.clawR = 0.3;
    p.pinchL = 0.2;
    p.pinchR = 0.2;
    p.eyes = 1.05;
    p.look = 0.15 * Math.sin(t * 1.7 + seed);
    return p;
  },

  /** A pause at a line's corner or end: up on its toes, eyes up, looking about, a claw tapping the sand. */
  look(t, seed) {
    const p = emptyPose();
    breathe(p, t, seed);
    p.bob = 0.012 * ramp(t, 0, 0.3);
    p.squash = -0.06 * ramp(t, 0, 0.3) + 0.04 * ring(t, 14, 5);
    p.eyes = 1.2;
    p.look = 0.6 * Math.sin(t * 2.4 + seed);
    p.pitch = 0.12 * ramp(t, 0, 0.4);
    const tap = Math.max(0, Math.sin(t * 9)) * ramp(t, 0.3, 0.5);
    p.clawR = 0.35 - 0.25 * tap;
    p.pinchR = 0.5 * tap;
    return p;
  },

  /** Both claws up, waving — a little hello. */
  wave(t, seed) {
    const p = emptyPose();
    breathe(p, t, seed);
    const up = window4(t, 0, 0.3, 2.0, 2.4);
    p.clawL = 0.15 + 0.85 * up + 0.15 * Math.sin(t * 8) * up;
    p.clawR = 0.15 + 0.85 * up + 0.15 * Math.sin(t * 8 + Math.PI) * up;
    p.pinchL = 0.5 + 0.5 * Math.sin(t * 12) * up;
    p.pinchR = 0.5 + 0.5 * Math.sin(t * 12 + 1) * up;
    p.bob = 0.015 * up + 0.006 * Math.sin(t * 8) * up;
    p.squash = -0.08 * up + 0.05 * ring(t, 16, 5);
    p.roll = 0.08 * Math.sin(t * 4) * up;
    p.eyes = 1.15;
    p.look = 0;
    return p;
  },

  /** Scrabbling at the sand in place (pottering about). */
  dig(t, seed) {
    const p = emptyPose();
    breathe(p, t, seed);
    const on = window4(t, 0, 0.25, 1.8, 2.2);
    p.dig = on;
    p.pitch = 0.18 * on;
    p.bob = -0.006 * on;
    p.roll = 0.06 * Math.sin(t * 17) * on;
    p.clawL = 0.05;
    p.clawR = 0.05;
    return p;
  },

  /** Digging down until only the eyes show. */
  burrow(t, seed) {
    const p = emptyPose();
    breathe(p, t, seed);
    p.dig = window4(t, 0, 0.15, 1.1, 1.5);
    p.burrow = 0.92 * ramp(t, 0.15, 1.35);
    p.roll = 0.1 * Math.sin(t * 19) * (1 - ramp(t, 1.0, 1.4));
    p.pitch = 0.12 * window4(t, 0, 0.2, 1.0, 1.4);
    p.clawL = 0.05;
    p.clawR = 0.05;
    p.eyes = 1.1;
    return p;
  },

  /** Under the sand, eyes up, looking around. */
  buried(t, seed) {
    const p = emptyPose();
    p.burrow = 0.92;
    p.eyes = 1.1 - 0.9 * pulse(t, seed, 3.5, 0.1, 6);
    p.look = 0.5 * Math.sin(t * 0.9 + seed) + 0.4 * (pulse(t, seed, 2.2, 0.3, 7) - pulse(t, seed, 3.1, 0.3, 8));
    return p;
  },

  /** Popping back up out of the sand. */
  emerge(t, seed) {
    const p = emptyPose();
    breathe(p, t, seed);
    p.burrow = 0.92 * (1 - ramp(t, 0, 0.45));
    p.dig = window4(t, 0, 0.1, 0.3, 0.5);
    p.squash = -0.14 * window4(t, 0.25, 0.4, 0.45, 0.55) + 0.12 * ring(t - 0.5, 16, 6);
    p.bob = 0.02 * window4(t, 0.3, 0.42, 0.45, 0.6);
    p.eyes = 1.2;
    return p;
  },

  /** Picked up: legs paddling at the air, claws up. */
  held(t, seed) {
    const p = emptyPose();
    p.gait = 1.3;
    p.bob = 0.12;
    p.clawL = 0.7 + 0.2 * Math.sin(t * 9);
    p.clawR = 0.7 + 0.2 * Math.sin(t * 9 + 2);
    p.pinchL = 0.5 + 0.5 * Math.sin(t * 13);
    p.pinchR = 0.5 + 0.5 * Math.sin(t * 13 + seed);
    p.eyes = 1.2;
    p.roll = 0.1 * Math.sin(t * 5);
    return p;
  },
};

export function behave(name: BehaviourName, t: number, seed: number): Pose {
  return behaviours[name](Math.max(0, t), seed);
}
