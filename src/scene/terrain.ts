import * as THREE from 'three';
import { TILE, terrainHeight, terrainNormal } from './beach';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { BEACH_GLSL } from './beachGlsl';
import { MAX_RIPPLES, type WorldUniforms } from './world';

/**
 * The painted cove in one surface: sand, the sheet of water a wave pushes
 * up it, and the sea. Colour is laid in the way a gouache illustrator
 * would — broad washes of pale gold, a darker band of wet sand, turquoise
 * shallows into blue — then grain, ripple marks and dry-brush flecks over
 * it, and a ragged edge where the paint runs out onto the paper.
 *
 * Lines pressed into the sand live in the heightmap (uSand): the vertex
 * shader lowers the surface into them, and the fragment shader takes its
 * normal from the heightmap per pixel so a 3 cm groove reads as pressed in
 * under the painted light.
 */

const vertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${BEACH_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += grooveHeight(texture2D(uSand, sandUv(wp.xz)));
  vWorld = wp.xyz;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${BEACH_GLSL}
uniform vec4 uRipples[${MAX_RIPPLES}];
varying vec3 vWorld;
varying vec3 vNormal;

float rippleRings(vec2 xz) {
  float k = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 2.4 || r.w <= 0.0) continue;
    float life = 1.0 - age / 2.4;
    float d = length(xz - r.xy) - (0.08 + age * 0.5);
    float w = 0.03 + age * 0.02;
    k += exp(-pow(d / w, 2.0)) * r.w * life * life;
    k += exp(-pow((length(xz - r.xy) - (0.04 + age * 0.3)) / (w * 0.8), 2.0)) * r.w * life * life * 0.5 * smoothstep(0.15, 0.5, age);
  }
  return min(k, 1.0);
}

// Round specks: grains, bubbles. cell = scale, returns 0..1 coverage, id via hash.
float speck(vec2 p, float scale, float density, float radius, out float id) {
  vec2 c = p * scale;
  vec2 cell = floor(c);
  id = hash12(cell + 0.37);
  vec2 off = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 0.5 + 0.25;
  float on = step(1.0 - density, hash12(cell));
  return on * smoothstep(radius, radius * 0.6, length(fract(c) - off));
}

// Cellular lace: the distance to the nearest of a set of drifting points, and the gap
// to the second nearest. Foam gathers along the cell walls, where that gap is small.
vec2 cells(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(n + g), hash12(n + g + 19.7));
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}
/** A web of foam threads (1 on a thread). */
float lace(vec2 p, float t, float thick) {
  // warp the cells so the web never looks like paving
  p += vec2(vnoise(p * 0.7 + t * 0.1), vnoise(p * 0.7 + 5.3 - t * 0.1)) * 0.9;
  return 1.0 - smoothstep(thick * 0.35, thick, cells(p, t).y);
}
/** White water: mostly foam, with round holes where the water shows through. */
float froth(vec2 p, float t, float hole) {
  p += vec2(vnoise(p * 0.6 - t * 0.1), vnoise(p * 0.6 + 3.7)) * 0.7;
  // holes of varied size, and only half see-through: foam is mostly white
  float h = hole * (0.55 + 0.6 * vnoise(p * 0.9));
  return mix(0.45, 1.0, smoothstep(h * 0.7, h, cells(p, t).x));
}
/** Foam comes in patches: 1 where there is some, fading out between. */
float patches(vec2 p, float cover) {
  float n = vnoise(p) * 0.65 + vnoise(p * 2.3 + 7.1) * 0.35;
  return smoothstep(1.0 - cover, 1.0 - cover + 0.22, n);
}

vec3 seaPaint(vec2 xz, float d, float calm) {
  // turquoise shallows into deeper blue, laid in soft washes
  float wash = fbm2lite(xz * 0.18 + vec2(uTime * 0.01, 0.0));
  vec3 shallow = srgb(vec3(0.5, 0.8, 0.76));
  vec3 mid = srgb(vec3(0.3, 0.64, 0.72));
  vec3 deep = srgb(vec3(0.2, 0.47, 0.64));
  vec3 c = mix(shallow, mid, smoothstep(0.0, 1.6, d + (wash - 0.5) * 0.6));
  c = mix(c, deep, smoothstep(1.4, 4.0, d + (wash - 0.5) * 0.8));
  // sand showing through the very shallow water
  c = mix(c, srgb(vec3(0.72, 0.78, 0.62)), smoothstep(0.5, 0.0, d) * 0.45);
  // long dry-brush strokes along the swell
  float wx = xz.x + (vnoise(xz * 0.37 + 9.3) - 0.5) * 3.0;
  float stroke = vnoise(vec2(wx * 0.35 + uTime * 0.02, d * 5.0)) * 0.6 + vnoise(vec2(wx * 1.2 + 3.3, d * 13.0)) * 0.4;
  c *= 0.94 + 0.1 * stroke;
  return c;
}

void main() {
  vec2 xz = vWorld.xz;
  // dry-brush edge: paint thins, then breaks into specks on the paper
  float edge = paintEdge(xz);
  float coverEdge = smoothstep(-0.05, 0.5, edge);
  if (hash12(floor(xz * 28.0)) > coverEdge * 1.08) discard;

  float u = upBeach(xz);
  float calm = uCalm;
  vec3 V = normalize(cameraPosition - vWorld);
  float clouds = cloudLight(xz);
  vec3 col;

  if (u < 0.0) {
    // ---- the sea ----
    float d = -u;
    float t = uTime;
    vec3 albedo = seaPaint(xz, d, calm);
    // the swell: broad soft bands rolling in, a lighter back and a deeper trough
    float swell = sin(d * 1.3 + t * mix(0.55, 0.32, calm) + (vnoise(xz * vec2(0.25, 0.8)) - 0.5) * 1.4);
    albedo *= 1.0 + 0.07 * swell * smoothstep(0.3, 2.2, d);
    // the next wave steepening: its face turns a deeper, clearer green before it breaks
    float approach = clamp((uWaveTau - 0.72) / 0.28, 0.0, 1.0);
    float coming = step(0.72, uWaveTau);
    float crestD = mix(3.2, 0.15, approach);
    float face = exp(-pow((d - crestD - 0.32) / 0.3, 2.0)) * coming;
    albedo = mix(albedo, albedo * vec3(0.78, 0.95, 0.9), face * 0.55);

    float sunVis = castLight(vWorld, 0.03) * clouds;
    col = paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2);

    // caustics: a slow net of light on the sand under the shallows
    // (each pattern is only worked out where it can show: the cell search is the costly part)
    if (d < 1.1) {
      float caus = lace(xz * vec2(3.4, 4.0) + vec2(0.0, t * 0.04), t * 0.6, 0.1) * smoothstep(1.1, 0.15, d) * smoothstep(0.0, 0.15, d);
      col += uSunColor * caus * 0.045 * sunVis;
    }
    // foam lines drifting shoreward: broken threads of lace, not stripes
    float drift = t * mix(0.09, 0.05, calm);
    float band = fract(d * 0.55 - drift + (vnoise(xz * vec2(0.4, 1.0)) - 0.5) * 0.35);
    float bandMask = smoothstep(0.13, 0.0, abs(band - 0.5)) * smoothstep(4.6, 0.8, d) * (0.4 + 0.6 * vnoise(xz * vec2(0.6, 1.5) + t * 0.03));
    float foamLine = bandMask < 0.003 ? 0.0 : bandMask * lace(xz * vec2(2.6, 4.2) + vec2(t * 0.04, -t * 0.07), t * 0.35, 0.16) * patches(xz * vec2(0.5, 1.2) + t * 0.02, 0.6);
    // the crest breaking into white water, which tumbles in toward the shore
    float crestBand = exp(-pow((d - crestD) / (0.09 + 0.12 * approach), 2.0)) * coming;
    float crest = crestBand < 0.003 ? 0.0 : crestBand * (0.55 + 0.45 * lace(xz * vec2(2.4, 3.2) + vec2(0.0, t * 0.3), t * 1.2, 0.3));
    float whiteMask = smoothstep(crestD + 0.05, crestD - 0.6, d) * smoothstep(0.0, 0.25, approach) * coming;
    float white = whiteMask < 0.003 ? 0.0 : whiteMask
                * froth(xz * vec2(8.0, 9.5) + vec2(0.0, t * 0.5), t * 1.5, 0.3) * patches(xz * vec2(0.9, 1.6) - t * 0.1, 0.7) * 0.8;
    // the surge at the shoreline as the wave runs in
    float surgeMask = smoothstep(0.7, 0.0, d) * (1.0 - smoothstep(0.0, 0.25, uWaveTau)) * step(0.0005, uWaveTau);
    float surge = surgeMask < 0.003 ? 0.0 : surgeMask
                * froth(xz * vec2(8.5, 10.0) + vec2(0.0, -t * 0.6), t * 1.2, 0.3) * patches(xz * vec2(0.8, 1.5) + t * 0.1, 0.75);
    float foam = max(foamLine * 0.8, max(crest * 0.95, max(white, surge * 0.9)));
    // a soft wet line where the sea meets the sand
    foam = max(foam, smoothstep(0.1, 0.0, d) * 0.55 * (0.5 + 0.5 * vnoise(xz * 5.0)));
    // spray: a few drops flung up off the breaking crest
    float sid;
    float spray = speck(xz + vec2(0.0, -t * 0.4), 18.0, 0.18, 0.3, sid) * crestBand * step(0.5, approach);
    float rip = rippleRings(xz);
    col = mix(col, uSunColor * srgb(vec3(0.97, 0.98, 0.95)), clamp(foam + spray + rip * 0.6, 0.0, 0.92));
    // sun-glitter on the backs of the swell: round sparkles that come and go
    float gid;
    float glit = speck(xz + vec2(t * 0.05, 0.0), 6.0, 0.08, 0.16, gid) * step(0.6, fract(gid * 13.0 + t * 0.35)) * smoothstep(0.4, 1.8, d) * smoothstep(0.0, 0.8, swell);
    float streak = smoothstep(0.72, 0.88, vnoise(vec2(xz.x * 0.3 - t * 0.03, d * 2.2))) * 0.22;
    col += uSunColor * (glit * 0.6 + streak * 0.35) * sunVis;
    // the sky's pale reflection, stronger at a grazing look
    col = mix(col, srgb(vec3(0.86, 0.93, 0.96)), pow(1.0 - max(V.y, 0.0), 3.0) * 0.25);
    // drawn waves: little arched pen strokes scattered over the water, like a quick sketch of a sea
    vec2 wg = xz * vec2(1.05, 2.1) + vec2(t * 0.025, 0.0);
    wg.x += hash12(vec2(floor(wg.y), 5.0)) * 3.0; // stagger the rows
    vec2 wid = floor(wg);
    vec2 wf = fract(wg) - 0.5 - (vec2(hash12(wid + 3.1), hash12(wid + 7.7)) - 0.5) * 0.35;
    float wlen = 0.18 + 0.12 * hash12(wid + 1.3);
    float arc = wf.y - (1.5 * wf.x * wf.x - 0.04);
    float dash = (1.0 - smoothstep(0.0, fwidth(arc) * 1.5, abs(arc))) * smoothstep(wlen, wlen * 0.55, abs(wf.x));
    dash *= step(0.5, hash12(wid)) * smoothstep(0.45, 1.1, d);
    col = mix(col, col * vec3(0.5, 0.62, 0.74), dash * (0.55 + 0.35 * vnoise(xz * 6.0)));
  } else {
    // ---- the sand ----
    vec4 s = sandAt(xz);
    // per-pixel normal from the heightmap, over the beach's gentle slope
    vec2 tx = vec2(uSandTexel.x, 0.0), tz = vec2(0.0, uSandTexel.y);
    vec2 uv = sandUv(xz);
    float hx = grooveHeight(texture2D(uSand, uv + tx)) - grooveHeight(texture2D(uSand, uv - tx));
    float hz = grooveHeight(texture2D(uSand, uv + tz)) - grooveHeight(texture2D(uSand, uv - tz));
    vec2 step2 = 2.0 * vec2(HALF_X, HALF_Z) * 2.0 * uSandTexel;
    vec3 Ng = normalize(vec3(-hx / step2.x, 1.0, -hz / step2.y));
    vec3 N = normalize(vNormal + vec3(Ng.x, 0.0, Ng.z) * 2.0);

    // ripple marks left by earlier tides, strongest on the lower beach
    float rz = u * 7.5 + (vnoise(xz * 0.8) - 0.5) * 2.2 + sin(xz.x * 0.9) * 0.4;
    float ripples = sin(rz) * smoothstep(0.2, 1.2, u) * smoothstep(4.8, 2.5, u) * (0.6 + 0.4 * vnoise(xz * 0.35 + 5.0));
    N = normalize(N + vec3(0.0, 0.0, cos(rz) * 0.09) * smoothstep(0.2, 1.2, u) * smoothstep(4.8, 2.5, u));

    float baseWet = 1.0 - smoothstep(WET_REACH * 0.55, WET_REACH, u + (vnoise(xz * 1.3) - 0.5) * 0.5);
    float recent = s.b; // wetness left by the last wave
    float wet = max(baseWet, recent * 0.85);
    vec3 albedo = sandPaint(xz, wet);
    albedo *= 1.0 + 0.035 * ripples;

    // the high-water mark: a faint damp band where the big waves stop
    float hw = highWaterU(xz.x);
    albedo *= 1.0 - 0.07 * exp(-pow((u - hw + 0.15) / 0.35, 2.0)) * (0.5 + 0.5 * vnoise(xz * 2.0));
    // dunes at the back: paler, with a cool green cast among the grass
    float dune = smoothstep(0.2, -1.4, xz.y - duneZ(xz.x));
    albedo = mix(albedo, albedo * vec3(1.02, 1.03, 0.95), dune * 0.6);

    // grains: a fine round stipple, the odd dark or shell-pale one
    float gid;
    float grain = speck(xz, 85.0, 0.22, 0.32, gid);
    albedo *= 1.0 + grain * (gid > 0.5 ? 0.12 : -0.14);
    float fleck = speck(xz, 14.0, 0.035, 0.3, gid) * (1.0 - wet);
    albedo = mix(albedo, albedo * 1.12 + srgb(vec3(0.05, 0.04, 0.02)), fleck * 0.8);

    // the groove: damp and darker in the trough, a little pale lip pushed up either side
    float trough = s.r;
    float lip = s.g * (1.0 - s.r);
    // pressing through the surface finds damper, warmer sand underneath
    vec3 under = mix(vec3(0.8, 0.68, 0.54), vec3(0.64, 0.52, 0.4), wet);
    albedo *= mix(vec3(1.0), under, smoothstep(0.05, 0.75, trough));
    albedo = mix(albedo, albedo * vec3(1.1, 1.08, 1.04), smoothstep(0.1, 0.7, lip) * (0.7 - 0.4 * wet));
    // a few grains knocked loose along the edges
    float loose = speck(xz + 0.13, 120.0, 0.4, 0.38, gid) * smoothstep(0.15, 0.6, s.g) * (1.0 - smoothstep(0.3, 0.7, s.r));
    albedo *= 1.0 + loose * (gid > 0.4 ? 0.16 : -0.2) * (1.2 - wet * 0.5);

    float castVis = castLight(vWorld, 0.025);
    float sunVis = castVis * clouds;
    col = paintLight(albedo, N, sunVis, 1.0, 0.22 - 0.08 * wet);
    // shadows cast on the sand are hatched in pencil, as well as shaded
    col = hatch(col, vWorld, smoothstep(0.05, 0.6, 1.0 - castVis));
    // cavity: the bottom of a groove is out of the open sky
    col *= 1.0 - 0.22 * smoothstep(0.3, 1.0, trough);

    // wet sand holds a glossy sheen of sky, freshest just after a wave
    float gloss = recent * 0.8 + baseWet * 0.2;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col = mix(col, srgb(vec3(0.9, 0.9, 0.88)) * uSunColor, gloss * (0.04 + 0.16 * fres) * (0.6 + 0.4 * vnoise(xz * 0.7)));
    vec3 H = normalize(uSunDir + V);
    col += uSunColor * smoothstep(0.93, 0.995, dot(N, H)) * gloss * 0.35 * sunVis;

    // foam caught in the grooves, its bubbles popping one by one as it drains
    float bid;
    float bubble = speck(xz, 48.0, 0.75, 0.42, bid);
    float lingering = smoothstep(0.02, 0.2, s.a) * smoothstep(0.05, 0.3, s.r);
    float bubbles = bubble * step(bid, s.a * 1.2) * smoothstep(0.02, 0.3, s.r);
    col = mix(col, uSunColor * srgb(vec3(0.97, 0.97, 0.94)), clamp(lingering * 0.35 + bubbles * 0.7, 0.0, 0.85));

    // ---- the swash: a thin sheet of water pushed up the sand ----
    float front = waveFront(xz.x);
    float depth = front - u;
    if (depth > -0.25 && uWaveFront > 0.01) {
      float sheet = smoothstep(0.0, 0.12, depth);
      float t = uTime;
      bool up = uWaveTau < 0.4;
      // clear water over the sand, turquoise where it thickens
      vec3 water = mix(srgb(vec3(0.66, 0.9, 0.88)), srgb(vec3(0.38, 0.76, 0.78)), smoothstep(0.1, 1.6, depth));
      // sand seen through a film of clear water: a pale turquoise wash, glassier where it's deeper
      vec3 film = mix(col * vec3(0.9, 0.98, 1.0), uSunColor * water, 0.22 + 0.3 * smoothstep(0.0, 1.6, depth));
      col = mix(col, film, sheet * 0.8);
      // the leading edge: a bright thread of foam, and behind it a band of lace —
      // thick and tumbling as the wave runs up, a fine broken net as it draws back
      float flow = up ? -t * 0.55 : t * 0.3;
      // running up it froths; drawing back it thins to a net of threads
      float edgeW = up ? 0.3 : 0.12;
      float bandMask = smoothstep(edgeW, 0.0, depth) * step(0.0, depth);
      float web = bandMask < 0.003 ? 0.0 : up ? froth(xz * vec2(8.0, 9.5) + vec2(0.0, flow), t * 1.1, 0.3) : lace(xz * vec2(3.0, 4.2) + vec2(0.0, flow), t * 1.1, 0.2);
      float thread = smoothstep(0.035, 0.0, abs(depth - 0.02)) * (0.6 + 0.4 * vnoise(xz * 11.0 + t));
      float band = bandMask * patches(xz * vec2(1.4, 2.0) + vec2(0.0, flow * 0.3), up ? 0.85 : 0.65);
      // trails of foam drawn out along the flow inside the sheet
      float trails = depth > 1.0 ? 0.0 : lace(xz * vec2(3.0, 1.4) + vec2(0.0, flow * 0.8), t * 0.5, 0.1) * patches(xz * vec2(0.9, 0.5) + vec2(0.0, flow * 0.4), 0.3) * sheet * smoothstep(1.0, 0.15, depth) * 0.4;
      float foam = clamp(max(thread * 0.9, band * web) + trails, 0.0, 1.0);
      col = mix(col, uSunColor * srgb(vec3(0.97, 0.98, 0.96)), foam * 0.88);
      // as the water slips back, the sand just above it glistens like glass for a moment
      if (!up) {
        float glisten = smoothstep(-0.7, -0.05, depth) * smoothstep(0.02, -0.05, depth);
        col = mix(col, srgb(vec3(0.9, 0.95, 0.97)) * uSunColor, glisten * (0.18 + 0.3 * pow(1.0 - max(V.y, 0.0), 2.0)));
      }
      // light catching the moving water: small round sparkles
      float gid2;
      float sparkle = speck(xz + vec2(0.0, t * (up ? -0.4 : 0.25)), 26.0, 0.012, 0.25, gid2);
      col += uSunColor * sparkle * sheet * 0.5 * sunVis * step(0.5, fract(gid2 * 7.0 + t * 0.6));
      col = mix(col, uSunColor * srgb(vec3(0.97, 0.98, 0.96)), rippleRings(xz) * 0.5 * sheet);
    }
  }

  // the water's edge, inked: a fine blue-grey pen line along the sea and the running wave,
  // pressed harder in places and lifting off now and then
  float waterEdge = max(waveFront(xz.x), 0.0) - u;
  float pen = 1.0 - smoothstep(0.0, fwidth(waterEdge) * 2.0, abs(waterEdge + 0.015));
  pen *= smoothstep(0.08, 0.28, vnoise(xz * vec2(1.3, 2.0) + 2.0)) * (0.65 + 0.35 * vnoise(xz * 7.0));
  col = mix(col, col * vec3(0.34, 0.43, 0.52), pen * 0.85);

  col = disco(col, vWorld);
  // where the paint thins at the edge, the paper shows through
  col = mix(uPaper, col, 0.55 + 0.45 * smoothstep(0.0, 0.7, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGeometry(step: number): THREE.BufferGeometry {
  const cols = Math.round((TILE.halfX * 2) / step);
  const rows = Math.round((TILE.halfZ * 2) / step);
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const normals = new Float32Array(positions.length);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    const z = -TILE.halfZ + r * step;
    for (let c = 0; c <= cols; c++) {
      const x = -TILE.halfX + c * step;
      const [nx, ny, nz] = terrainNormal(x, z);
      positions[k] = x;
      positions[k + 1] = terrainHeight(x, z);
      positions[k + 2] = z;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
      k += 3;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], o);
      o += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function createTerrain(world: WorldUniforms, quality: 'high' | 'low'): THREE.Mesh {
  const material = new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment });
  const mesh = new THREE.Mesh(buildGeometry(quality === 'high' ? 0.045 : 0.07), material);
  mesh.name = 'beach';
  return mesh;
}
