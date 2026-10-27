/**
 * Where a crab's parts are, shared by the painted model (CrabView) and the
 * controller, which needs to know where each foot comes down so it can
 * leave a footprint. Plain numbers, no three.js.
 */

/** Crabs are drawn larger than life, so they read at the app's camera (MEADOW's rule). */
export const CRAB_SCALE = 1.75;

/** Hip mounts along the body (local z) and how far each leg fans forward or back. */
export const HIPS: readonly { z: number; fan: number }[] = [
  { z: 0.06, fan: 0.6 },
  { z: 0.02, fan: 0.2 },
  { z: -0.025, fan: -0.2 },
  { z: -0.07, fan: -0.6 },
];

/** Legs in order: four on the right (+x) side, then four on the left. */
export const LEGS: readonly { side: 1 | -1; index: number }[] = [1, -1].flatMap((side) => HIPS.map((_, index) => ({ side: side as 1 | -1, index })));

/** A leg's own phase in the scuttle: alternating sets, the two sides half a cycle apart. */
export function legPhase(phase: number, leg: { side: 1 | -1; index: number }): number {
  return phase + (leg.index % 2) * Math.PI + (leg.side > 0 ? 0 : Math.PI);
}

const TAU = Math.PI * 2;
/** A foot is lifted while cos(phase) > 0 and comes down as it crosses π/2 (mod 2π). */
const DOWN = Math.PI / 2;

/** Which legs came down between two phases of the cycle. */
export function footfalls(prevPhase: number, phase: number): number[] {
  if (phase <= prevPhase) return [];
  const out: number[] = [];
  LEGS.forEach((leg, i) => {
    const a = legPhase(prevPhase, leg) - DOWN, b = legPhase(phase, leg) - DOWN;
    if (Math.floor(b / TAU) > Math.floor(a / TAU)) out.push(i);
  });
  return out;
}

/** Where a foot rests, in world metres, for a crab at (x, z) turned by `heading` and sized by `scale`. */
export function footWorld(x: number, z: number, heading: number, scale: number, legIndex: number): { x: number; z: number } {
  const leg = LEGS[legIndex];
  const hip = HIPS[leg.index];
  const reach = 0.095;
  const lx = leg.side * (0.12 + reach * Math.cos(hip.fan));
  const lz = hip.z + reach * Math.sin(hip.fan) * 0.9;
  const k = CRAB_SCALE * scale;
  const c = Math.cos(heading), s = Math.sin(heading);
  // rotation about y: local (lx, lz) -> world (lx c + lz s, -lx s + lz c)
  return { x: x + (lx * c + lz * s) * k, z: z + (-lx * s + lz * c) * k };
}
