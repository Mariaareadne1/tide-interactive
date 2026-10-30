import * as THREE from 'three';
import { TILE, duneZ, edgeDistance, rockDistance, terrainHeight } from './beach';
import { fbm2, seededRandom } from './noise';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * Marram grass along the dunes at the back of the cove: MEADOW's painted
 * tufts, taller, thinner and sandier, leaning with the sea breeze and
 * thinning out where the dunes give way to the beach.
 */

function tuftGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  const tip: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI + 0.3;
    const lean = (b - (blades - 1) / 2) * 0.32;
    const cx = Math.cos(a), cz = Math.sin(a);
    const h = 0.75 + 0.25 * Math.sin(b * 2.1);
    pos.push(-0.01 * cx, 0, -0.01 * cz, 0.01 * cx, 0, 0.01 * cz, lean * 0.12, h, Math.sin(b * 1.7) * 0.05);
    tip.push(0, 0, 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  return geo;
}

const vertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
attribute vec4 aOffset; // xyz base, w yaw
attribute vec2 aSize;   // height, rand
attribute float aTip;
varying vec3 vWorld;
varying float vTip;
varying float vRand;
void main() {
  float c = cos(aOffset.w), s = sin(aOffset.w);
  vec3 p = position;
  p = vec3(c * p.x - s * p.z, p.y * aSize.x, s * p.x + c * p.z);
  // the breeze comes off the sea (from +z): blades lean back toward the dunes
  float gust = vnoise(aOffset.xz * 0.4 + vec2(uTime * 0.6, 0.0));
  p.z -= (0.03 + 0.06 * gust) * uWind * aTip * aSize.x;
  p.x += (vnoise(aOffset.xz + uTime * 0.9) - 0.5) * 0.03 * uWind * aTip;
  vec4 wp = vec4(aOffset.xyz + p, 1.0);
  vWorld = wp.xyz;
  vTip = aTip;
  vRand = aSize.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vWorld;
varying float vTip;
varying float vRand;
void main() {
  vec3 base = mix(srgb(vec3(0.24, 0.58, 0.22)), srgb(vec3(0.34, 0.66, 0.24)), vRand);
  vec3 tip = mix(srgb(vec3(0.66, 0.84, 0.3)), srgb(vec3(0.52, 0.76, 0.26)), vRand);
  vec3 albedo = mix(base, tip, smoothstep(0.2, 1.0, vTip));
  float sunVis = castLight(vWorld, 0.04);
  gl_FragColor = vec4(disco(paintLight(albedo, normalize(vec3(0.0, 1.0, 0.4)), sunVis, 1.0, 0.25), vWorld), 1.0);
}
`;

export function createDetails(world: WorldUniforms, density = 1): THREE.Mesh {
  const rand = seededRandom(5);
  const tufts: [number, number, number][] = [];
  const want = Math.round(1500 * density);
  let attempts = 0;
  while (tufts.length < want && attempts++ < want * 30) {
    const x = (rand() * 2 - 1) * TILE.halfX;
    const z = (rand() * 2 - 1) * TILE.halfZ;
    const into = duneZ(x) - z; // metres into the dunes
    if (edgeDistance(x, z) < 0.45 || rockDistance(x, z) < 0.05) continue;
    // clumped by noise, thickest on the dune crests, a few stragglers out on the sand
    // (rotated, so the value noise's grid doesn't leave straight-edged clumps)
    const clump = 0.5 + fbm2((x * 0.8 + z * 0.6) / 1.6, (z * 0.8 - x * 0.6) / 1.6, 3);
    const p = into > 0 ? Math.min(1, 0.25 + into * 0.6) * clump : Math.exp(into * 3) * 0.25 * clump;
    if (rand() > p) continue;
    tufts.push([x, z, into]);
  }
  const offset = new Float32Array(tufts.length * 4);
  const size = new Float32Array(tufts.length * 2);
  tufts.forEach(([x, z, into], i) => {
    offset.set([x, terrainHeight(x, z) - 0.01, z, rand() * Math.PI * 2], i * 4);
    size.set([(0.16 + rand() * 0.2) * (into > 0 ? 1 : 0.6), rand()], i * 2);
  });
  const geo = tuftGeometry();
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 4));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  geo.instanceCount = tufts.length;
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.name = 'dune grass';
  return mesh;
}
