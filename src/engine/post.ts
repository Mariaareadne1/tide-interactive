import * as THREE from 'three';

/**
 * Final pass: ink outlines drawn from the depth buffer, exposure, a neutral
 * photographic tone curve, the cool blue-violet shadow grade, a soft
 * vignette, the paper's tooth, and fine grain + dither.
 * The scene renders linear HDR into a multisampled target; this writes sRGB.
 */

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uInk;
uniform float uExposure;
uniform float uTime;
uniform float uGrain;
uniform vec2 uResolution;
varying vec2 vUv;

// Khronos PBR Neutral: keeps albedo hues honest, rolls off highlights gently.
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// 1 / view depth: affine in screen space across any flat surface, so its
// second difference is ~0 on the sand and spikes only at silhouettes
float invDepth(vec2 uv, inout float far) {
  float d = texture2D(tDepth, uv).r;
  far = max(far, step(0.99999, d));
  float z = d * 2.0 - 1.0;
  return (uFar + uNear - z * (uFar - uNear)) / (2.0 * uNear * uFar);
}

/** Ink: where something stands in front of what's behind it, a thin wobbly line, like a pen. */
float ink(vec2 uv) {
  // the pen wanders a little, and presses harder in places
  vec2 fc = uv * uResolution;
  float scale = max(1.0, uResolution.y / 1000.0);
  vec2 wob = (vec2(vnoise(fc / (34.0 * scale)), vnoise(fc / (34.0 * scale) + 17.3)) - 0.5) * 1.4 * scale;
  vec2 px = scale * 0.9 / uResolution;
  vec2 p = uv + wob / uResolution;
  float far = 0.0;
  float c = invDepth(p, far);
  float lap = abs(invDepth(p + vec2(px.x, 0.0), far) + invDepth(p - vec2(px.x, 0.0), far) - 2.0 * c)
            + abs(invDepth(p + vec2(0.0, px.y), far) + invDepth(p - vec2(0.0, px.y), far) - 2.0 * c);
  // nothing against the bare paper: the tile's ragged edge is paint, not a drawn line
  if (far > 0.5) return 0.0;
  float pressure = 0.65 + 0.35 * vnoise(fc / (60.0 * scale) + 4.0);
  return smoothstep(0.0008, 0.0032, lap / c) * pressure;
}

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb * uExposure;
  vec3 c = neutral(hdr);
  // a warm sepia ink, darkening what it crosses rather than painting over it
  c = mix(c, c * vec3(0.3, 0.25, 0.25) + vec3(0.012, 0.008, 0.01), ink(vUv) * uInk);

  // grade: pull shadows toward slate blue-violet, keep highlights warm and clean
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowTint = vec3(0.93, 0.95, 1.10);
  vec3 highTint = vec3(1.02, 1.0, 0.97);
  c *= mix(shadowTint, highTint, smoothstep(0.05, 0.55, luma));
  c = mix(vec3(luma), c, 0.97); // a touch of restraint on saturation

  // soft vignette
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  c *= 1.0 - 0.16 * smoothstep(0.35, 1.05, length(q));

  // the paper's tooth: fine fibres and a soft mottle under everything, paint included
  vec2 fc = vUv * uResolution / max(1.0, uResolution.y / 1000.0);
  float tooth = vnoise(fc / 2.2) * 0.55 + vnoise(fc / 9.0 + 3.1) * 0.3 + vnoise(fc / 70.0 + 7.7) * 0.15;
  c *= 0.975 + 0.05 * tooth;

  vec3 outc = toSRGB(clamp(c, 0.0, 1.0));
  float n = hash(vUv * uResolution + fract(uTime) * 91.7) - 0.5;
  outc += n * uGrain + (hash(vUv * uResolution * 1.37) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}
`;

export class PostPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(samples: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uNear: { value: 0.5 },
        uFar: { value: 400 },
        uInk: { value: 0.85 },
        uExposure: { value: 1.12 },
        uTime: { value: 0 },
        uGrain: { value: 0.012 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** The camera's clip planes, to read view depth back from the depth buffer. */
  setClip(near: number, far: number): void {
    this.material.uniforms.uNear.value = near;
    this.material.uniforms.uFar.value = far;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, time: number, output: THREE.WebGLRenderTarget | null = null): void {
    this.material.uniforms.uTime.value = time;
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
