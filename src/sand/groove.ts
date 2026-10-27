/**
 * The shape of a fingertip pressed through sand, shared by the GPU stamp
 * (sandGlsl.ts writes the same expressions) and a CPU reference used by
 * tests. Two quantities per texel, both 0..1 and max-combined:
 *   depth — the trough, deepest along the line
 *   lip   — sand pushed up into a little ridge either side
 * The rendered height is  -DEPTH·depth + LIP·lip·(1 - depth)  so a new
 * line's lip never fills an older line's trough.
 */

/** Real depth of a full-pressure groove (world m). */
export const GROOVE_DEPTH = 0.045;
/** Height of the pushed-up lip (world m). */
export const GROOVE_LIP = 0.016;
/** Half-width of the trough on wet sand (world m). */
export const GROOVE_HALF_WIDTH = 0.1;

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/**
 * Groove profile at distance d (m) from the finger's path. `wet` 1 gives a
 * crisp, darker line; 0 (dry sand) a wider, shallower, crumblier one.
 */
export function grooveProfile(d: number, wet: number, pressure = 1): { depth: number; lip: number } {
  const w = GROOVE_HALF_WIDTH * (1.25 - 0.25 * wet);
  const depth = smoothstep(w, w * 0.3, d) * pressure * (0.72 + 0.28 * wet);
  const lipD = (d - w * 1.25) / (w * (0.5 + 0.25 * (1 - wet)));
  const lip = Math.exp(-lipD * lipD) * pressure * (0.85 + 0.35 * (1 - wet));
  return { depth, lip };
}

/** Height (m) from the two channels. */
export function grooveHeight(depth: number, lip: number): number {
  return -GROOVE_DEPTH * depth + GROOVE_LIP * lip * (1 - depth);
}

export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** A CPU heightfield with the same channels and layout as the GPU one (row-major, z down rows). */
export class SandGrid {
  readonly depth: Float32Array;
  readonly lip: Float32Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly halfX: number,
    readonly halfZ: number,
  ) {
    this.depth = new Float32Array(cols * rows);
    this.lip = new Float32Array(cols * rows);
  }

  /** World position of a cell centre. */
  cellX(c: number): number {
    return ((c + 0.5) / this.cols * 2 - 1) * this.halfX;
  }
  cellZ(r: number): number {
    return ((r + 0.5) / this.rows * 2 - 1) * this.halfZ;
  }
  index(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x / this.halfX + 1) / 2 * this.cols)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((z / this.halfZ + 1) / 2 * this.rows)));
    return r * this.cols + c;
  }

  /** Stamp a polyline (max-combined, as the GPU blend does). */
  stamp(points: readonly { x: number; z: number }[], wetAt: (x: number, z: number) => number, pressure = 1): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const pad = GROOVE_HALF_WIDTH * 3;
      const c0 = Math.max(0, Math.floor(((Math.min(a.x, b.x) - pad) / this.halfX + 1) / 2 * this.cols));
      const c1 = Math.min(this.cols - 1, Math.ceil(((Math.max(a.x, b.x) + pad) / this.halfX + 1) / 2 * this.cols));
      const r0 = Math.max(0, Math.floor(((Math.min(a.z, b.z) - pad) / this.halfZ + 1) / 2 * this.rows));
      const r1 = Math.min(this.rows - 1, Math.ceil(((Math.max(a.z, b.z) + pad) / this.halfZ + 1) / 2 * this.rows));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = this.cellX(c), z = this.cellZ(r);
          const g = grooveProfile(segmentDistance(x, z, a.x, a.z, b.x, b.z), wetAt(x, z), pressure);
          const k = r * this.cols + c;
          if (g.depth > this.depth[k]) this.depth[k] = g.depth;
          if (g.lip > this.lip[k]) this.lip[k] = g.lip;
        }
      }
    }
  }

  /**
   * One erosion step, the CPU twin of the GPU evolve pass: inside the water
   * (cover > 0) both channels relax toward their neighbours and decay;
   * outside it nothing changes.
   */
  erode(cover: (x: number, z: number) => number, dt: number): void {
    const { cols, rows } = this;
    for (const ch of [this.depth, this.lip]) {
      const src = ch.slice();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          const w = cover(this.cellX(c), this.cellZ(r));
          if (w <= 0) continue;
          const n = (cc: number, rr: number) => src[Math.min(rows - 1, Math.max(0, rr)) * cols + Math.min(cols - 1, Math.max(0, cc))];
          const blur = (n(c - 1, r) + n(c + 1, r) + n(c, r - 1) + n(c, r + 1)) * 0.25;
          ch[k] = erodeValue(src[k], blur, w, dt);
        }
      }
    }
  }

  heightAt(x: number, z: number): number {
    const k = this.index(x, z);
    return grooveHeight(this.depth[k], this.lip[k]);
  }
}

/** Per-second decay of a groove under a full sheet of water. */
export const ERODE_RATE = 0.38;
/** How strongly water smears a groove into its neighbours each second. */
export const DIFFUSE_RATE = 5;

/** One texel's erosion step (shared reasoning with the GLSL evolve pass). */
export function erodeValue(v: number, blur: number, cover: number, dt: number): number {
  // smearing toward the neighbourhood never lifts a texel above it
  const mixed = v + (Math.min(blur, v) - v) * Math.min(1, cover * DIFFUSE_RATE * dt);
  return mixed * Math.exp(-ERODE_RATE * cover * dt);
}
