import { fbm2, noise2 } from './noise';

/**
 * The cove is a painted tile — 20 × 15 world metres — seen from above at a
 * three-quarter angle. World units are metres, y up; the camera sits on the
 * +z side looking toward -z, so the sea lies along the near edge and waves
 * run up the screen. Everything that needs the beach (mesh, details,
 * raycasts, the sand heightmap, crabs, waves) calls these functions, and the
 * GLSL twin in beachGlsl.ts is written from the same numbers.
 *
 * The tile is a miniature: one world metre is 20 cm of real beach, so the
 * whole cove is 4 × 3 m and a fingertip groove is about 3 cm wide.
 */

export const TILE = { halfX: 10, halfZ: 7.5 };
/** Real centimetres per world metre (for labels). */
export const CM_PER_M = 20;

/** The mean waterline: z as a function of x. The cove bows back in the middle. */
export function shoreZ(x: number): number {
  return 3.1 + 0.95 * (x / 10) ** 2 + 0.22 * Math.sin(x * 0.42 + 1.0);
}

/** Distance up the beach from the mean waterline (m): negative in the sea. */
export function upBeach(x: number, z: number): number {
  return shoreZ(x) - z;
}

/** How far up the beach the sand stays wet between waves. */
export const WET_REACH = 2.5;
/** The high-water mark (a line of washed-up seaweed), distance up the beach. */
export const HIGH_WATER = 5.4;
export function highWaterU(x: number): number {
  return HIGH_WATER + 0.35 * Math.sin(x * 0.55 + 0.4) + 0.18 * Math.sin(x * 1.7 + 2.0);
}

/** The dunes along the back edge start where z drops below this. */
export function duneZ(x: number): number {
  return -4.7 + 0.45 * Math.sin(x * 0.31 + 0.8) + 0.25 * Math.sin(x * 0.9 + 2.1);
}

export interface Rock {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly h: number;
  readonly seed: number;
}

/** A few rocks: a cluster in the dunes at the back left, an outcrop at the water on the right. */
export const ROCKS: readonly Rock[] = [
  { x: -8.1, z: -4.9, r: 0.95, h: 0.75, seed: 3 },
  { x: -6.9, z: -5.6, r: 0.55, h: 0.45, seed: 7 },
  { x: -8.8, z: -3.7, r: 0.4, h: 0.3, seed: 11 },
  { x: 8.2, z: 3.4, r: 0.85, h: 0.6, seed: 17 },
  { x: 7.3, z: 4.2, r: 0.45, h: 0.32, seed: 23 },
];

export function rockDistance(x: number, z: number): number {
  let d = Infinity;
  for (const r of ROCKS) d = Math.min(d, Math.hypot(x - r.x, z - r.z) - r.r);
  return d;
}

/** Distance (m) inside the tile's edge; negative outside. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(TILE.halfX - Math.abs(x), TILE.halfZ - Math.abs(z));
}

// --- height -------------------------------------------------------------------

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** The beach shelves gently up from the water and rises into soft dunes at the back. */
export function terrainHeight(x: number, z: number): number {
  const u = upBeach(x, z);
  if (u <= 0) return 0;
  let h = 0.035 * u + 0.025 * fbm2(x / 5 + 1.3, z / 5 - 0.7, 2) * smoothstep(0, 2, u);
  // dunes: a soft rise with lumps
  const dz = duneZ(x) - z;
  h += smoothstep(-0.6, 2.2, dz) * (0.28 + 0.12 * noise2(x / 1.7, z / 1.7));
  return h;
}

export function terrainNormal(x: number, z: number, eps = 0.05): [number, number, number] {
  const hx = terrainHeight(x + eps, z) - terrainHeight(x - eps, z);
  const hz = terrainHeight(x, z + eps) - terrainHeight(x, z - eps);
  const nx = -hx, ny = 2 * eps, nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

// --- what is where ------------------------------------------------------------

export type Surface = 'sand' | 'sea' | 'rock' | 'dune' | 'edge' | 'off';

/** Margin from the paint's ragged edge inside which the sand is too thin to draw in. */
export const EDGE_MARGIN = 0.6;

export function surfaceAt(x: number, z: number): Surface {
  const e = edgeDistance(x, z);
  if (e < 0) return 'off';
  if (upBeach(x, z) < 0) return 'sea';
  if (e < EDGE_MARGIN) return 'edge';
  if (rockDistance(x, z) < 0.05) return 'rock';
  if (z < duneZ(x) - 0.4) return 'dune';
  return 'sand';
}

/** Where a fingertip can press a line. */
export const isDrawable = (s: Surface) => s === 'sand';

/** 0 on bone-dry sand .. 1 at the water's edge (the static part; waves add more). */
export function baseWetness(x: number, z: number): number {
  return 1 - smoothstep(WET_REACH * 0.55, WET_REACH, upBeach(x, z));
}

/** Where crabs may walk: on sand, clear of rocks and the dune grass, off the paint's edge. */
export function isWalkable(x: number, z: number): boolean {
  return edgeDistance(x, z) > 0.8 && upBeach(x, z) > -0.15 && rockDistance(x, z) > 0.25 && z > duneZ(x) - 0.2;
}

/** Pull a point back onto walkable sand (for drags and wandering). */
export function clampWalkable(x: number, z: number): [number, number] {
  if (isWalkable(x, z)) return [x, z];
  for (let r = 0.1; r < 8; r += 0.1) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (isWalkable(px, pz)) return [px, pz];
    }
  }
  return [0, 0];
}
