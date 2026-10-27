import { HIGH_WATER, ROCKS, TILE, WET_REACH } from './beach';
import { GROOVE_DEPTH, GROOVE_HALF_WIDTH, GROOVE_LIP } from '../sand/groove';

/**
 * GLSL twin of beach.ts and waves.ts — the cove's layout, the sea's current
 * reach, and the sand heightmap lookup, shared by the beach, the stamp and
 * evolve passes, and everything that takes its colour from the sand under
 * it. Layout numbers are written in from the TypeScript so the two never
 * disagree.
 */

const f = (n: number) => n.toFixed(4);

const rockMin = ROCKS.map((r) => `  d = min(d, length(p - vec2(${f(r.x)}, ${f(r.z)})) - ${f(r.r)});`).join('\n');

export const BEACH_GLSL = /* glsl */ `
const float HALF_X = ${f(TILE.halfX)};
const float HALF_Z = ${f(TILE.halfZ)};
const float WET_REACH = ${f(WET_REACH)};
const float HIGH_WATER = ${f(HIGH_WATER)};
const float GROOVE_DEPTH = ${f(GROOVE_DEPTH)};
const float GROOVE_LIP = ${f(GROOVE_LIP)};
const float GROOVE_HW = ${f(GROOVE_HALF_WIDTH)};

// the sea right now: the front's reach (m up the beach), its wobble phases, the wave's local phase
uniform float uWaveFront;
uniform vec2 uWavePhase;
uniform float uWaveTau;
uniform float uWaveReach;
// sand heightmap: r groove depth, g lip, b wetness left by waves, a foam caught in grooves
uniform sampler2D uSand;
uniform vec2 uSandTexel;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float shoreZ(float x) { return 3.1 + 0.95 * pow(x / 10.0, 2.0) + 0.22 * sin(x * 0.42 + 1.0); }
float upBeach(vec2 p) { return shoreZ(p.x) - p.y; }
float highWaterU(float x) { return HIGH_WATER + 0.35 * sin(x * 0.55 + 0.4) + 0.18 * sin(x * 1.7 + 2.0); }
float duneZ(float x) { return -4.7 + 0.45 * sin(x * 0.31 + 0.8) + 0.25 * sin(x * 0.9 + 2.1); }
float rockDist(vec2 p) {
  float d = 99.0;
${rockMin}
  return d;
}

float frontWobble(float x) { return 1.0 + 0.1 * sin(x * 0.55 + uWavePhase.x) + 0.06 * sin(x * 1.3 + uWavePhase.y); }
/** How far up the beach the water reaches at x right now. */
float waveFront(float x) { return uWaveFront * frontWobble(x); }
/** 0 dry .. 1 under a full sheet of water; thin at the lacy edge. */
float waveCover(vec2 p) {
  float u = upBeach(p);
  if (u < 0.0) return 1.0;
  return smoothstep(0.0, 0.35, waveFront(p.x) - u);
}

vec2 sandUv(vec2 p) { return (p / vec2(HALF_X, HALF_Z)) * 0.5 + 0.5; }
vec4 sandAt(vec2 p) { return texture2D(uSand, sandUv(p)); }
float grooveHeight(vec4 s) { return -GROOVE_DEPTH * s.r + GROOVE_LIP * s.g * (1.0 - s.r); }

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 0.9;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.9;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.45 + (vnoise(xz * 4.0) - 0.5) * 0.22;
  return -box + rough;
}

/** Soft shadows of two clouds drifting slowly across the cove. 1 = clear. */
float cloudLight(vec2 xz) {
  float s = 1.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 c = vec2(mod(uTime * (0.16 + 0.05 * fi) + fi * 17.0 + 8.0, 34.0) - 17.0, -2.5 + fi * 5.5);
    vec2 q = (xz - c) / vec2(3.6 - fi * 0.8, 1.9);
    float n = vnoise(q * 1.6 + fi * 9.0) * 0.5;
    s *= mix(0.84, 1.0, smoothstep(0.55, 1.15, length(q) + n));
  }
  return s;
}

/** Sand's base paint, before light: dry pale gold to dark glossy wet. */
vec3 sandPaint(vec2 xz, float wet) {
  float wash = fbm2lite(xz * 0.14 + 3.0);
  vec3 dry = mix(srgb(vec3(0.93, 0.85, 0.69)), srgb(vec3(0.96, 0.89, 0.74)), smoothstep(0.3, 0.75, wash));
  // warm glaze pooling, like MEADOW's lawn light
  dry = mix(dry, dry * vec3(1.05, 1.0, 0.9), smoothstep(0.5, 0.8, fbm2lite(xz * 0.1 - 2.0)) * 0.6);
  vec3 damp = mix(srgb(vec3(0.78, 0.63, 0.46)), srgb(vec3(0.83, 0.69, 0.51)), smoothstep(0.3, 0.7, wash));
  vec3 c = mix(dry, damp, wet);
  // long dry-brush drags running along the shore
  float stroke = vnoise(vec2(xz.x * 0.45, xz.y * 6.0)) * 0.6 + vnoise(vec2(xz.x * 1.6, xz.y * 15.0)) * 0.4;
  c *= 0.95 + 0.09 * stroke;
  return c;
}
`;

/** Groove profile in GLSL — the same expressions as grooveProfile() in sand/groove.ts. */
export const GROOVE_GLSL = /* glsl */ `
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len2 = dot(ab, ab);
  float t = len2 > 0.0 ? clamp(dot(p - a, ab) / len2, 0.0, 1.0) : 0.0;
  return length(p - (a + t * ab));
}
vec2 grooveProfile(float d, float wet, float pressure, float width) {
  float w = GROOVE_HW * width * (1.25 - 0.25 * wet);
  float depth = smoothstep(w, w * 0.3, d) * pressure * (0.72 + 0.28 * wet);
  float lipD = (d - w * 1.25) / (w * (0.5 + 0.25 * (1.0 - wet)));
  float lip = exp(-lipD * lipD) * pressure * (0.85 + 0.35 * (1.0 - wet));
  return vec2(depth, lip);
}
`;
