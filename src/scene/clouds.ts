import * as THREE from 'three';
import { NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * Two small painted clouds drifting slowly along the tile's back edge, over
 * the paper: flat gouache puffs, white on top with a lavender underside,
 * that thin out as they drift off the ends of the page. (The soft shadows
 * crossing the sand come from clouds out of frame, above the camera.)
 */

export interface Clouds {
  group: THREE.Group;
  update(t: number): void;
}

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // billboard: the quad always faces the camera
  vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * (centre + vec4(position.xy * scale, 0.0, 0.0));
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
uniform float uSeed;
uniform float uFade;
varying vec2 vUv;
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  // a row of overlapping round puffs over a flat base
  float d = 9.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(-0.6 + fi * 0.3, -0.15 + 0.28 * sin(fi * 2.3 + uSeed) * step(0.5, mod(fi, 2.0) + 0.6));
    float r = 0.3 + 0.12 * sin(fi * 1.7 + uSeed * 3.0);
    d = min(d, length((p - c) * vec2(1.0, 1.6)) - r);
  }
  d = max(d, -p.y * 1.6 - 0.42);
  d += (vnoise(p * 7.0 + uSeed) - 0.5) * 0.08;
  float a = smoothstep(0.02, -0.03, d) * uFade;
  if (a < 0.01) discard;
  // dry-brush: the edge breaks into specks
  if (hash12(floor(vUv * vec2(120.0, 60.0)) + uSeed) > 0.4 + 0.6 * smoothstep(0.03, -0.08, d)) discard;
  vec3 top = srgb(vec3(1.0, 0.99, 0.97));
  vec3 under = srgb(vec3(0.82, 0.8, 0.92));
  vec3 col = mix(under, top, smoothstep(-0.35, 0.25, p.y + vnoise(p * 3.0 + uSeed) * 0.2));
  gl_FragColor = vec4(col * a, a);
}
`;

const CLOUDS = [
  { y: 3.6, z: -9.6, w: 4.2, speed: 0.12, phase: 0.1, seed: 1.3 },
  { y: 3.0, z: -10.4, w: 2.8, speed: 0.08, phase: 0.62, seed: 4.1 },
];
const SPAN = 34;

export function createClouds(world: WorldUniforms): Clouds {
  const group = new THREE.Group();
  group.name = 'clouds';
  const meshes = CLOUDS.map((c) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...world, uSeed: { value: c.seed }, uFade: { value: 1 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), mat);
    mesh.scale.set(c.w, c.w, 1);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  return {
    group,
    update(t: number) {
      CLOUDS.forEach((c, i) => {
        const k = (c.phase + (t * c.speed) / SPAN) % 1;
        const x = -SPAN / 2 + k * SPAN;
        meshes[i].position.set(x, c.y, c.z);
        (meshes[i].material as THREE.ShaderMaterial).uniforms.uFade.value = Math.min(1, Math.min(k, 1 - k) * 6);
      });
    },
  };
}
