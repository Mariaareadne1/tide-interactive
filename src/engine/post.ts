import * as THREE from 'three';

/**
 * Final pass: watercolour. Exposure and a neutral tone curve, then the
 * things paint does on paper — wash edges that wander, a little bleed,
 * pigment pooling darker at the edge of a wash, granulation in the paper's
 * tooth, uneven wet-in-wet blooms — a faint vignette, grain + dither.
 * The scene renders linear HDR into a multisampled target; this writes sRGB.
 */

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragment = /* glsl */ `
uniform sampler2D tScene;
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
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  // work in "paper pixels", so the paper's grain is the same size on any screen
  float scale = max(1.0, uResolution.y / 1000.0);
  vec2 pc = vUv * uResolution / scale;
  vec2 texel = scale / uResolution;

  // a wash's edge never runs quite where it was meant to: let the boundaries wander
  vec2 wob = (vec2(vnoise(pc / 38.0), vnoise(pc / 38.0 + 17.3)) - 0.5) * 2.4 + (vec2(vnoise(pc / 9.0 + 4.0), vnoise(pc / 9.0 + 9.0)) - 0.5) * 0.8;
  vec2 uv = vUv + wob * texel;

  // four neighbours a few pixels out serve twice: a little colour bleeds in from them,
  // and comparing against them finds the edge of a wash, where pigment pools
  vec2 r = 2.5 * texel;
  vec3 e1 = texture2D(tScene, uv + vec2(r.x, 0.0)).rgb, e2 = texture2D(tScene, uv - vec2(r.x, 0.0)).rgb;
  vec3 e3 = texture2D(tScene, uv + vec2(0.0, r.y)).rgb, e4 = texture2D(tScene, uv - vec2(0.0, r.y)).rgb;
  vec3 raw = texture2D(tScene, uv).rgb;
  vec3 ringRaw = (e1 + e2 + e3 + e4) * 0.25;
  vec3 c = neutral(mix(raw, ringRaw, 0.3) * uExposure);
  // where this side is darker than its surroundings it dries darker still, in a soft rim;
  // the light side lifts a touch (compared before the tone curve: the curve keeps the order)
  float diff = (luma(ringRaw) - luma(raw)) * uExposure;
  c *= 1.0 - clamp(diff * 3.0, 0.0, 0.3);
  c = mix(c, vec3(1.0), clamp(-diff * 0.8, 0.0, 0.06));

  // the paper's tooth, and pigment settling into its hollows (granulation): more pigment, more grain
  float tooth = vnoise(pc / 1.7) * 0.45 + vnoise(pc / 4.5 + 3.1) * 0.35 + vnoise(pc / 22.0 + 7.7) * 0.2;
  float pigment = clamp((0.92 - luma(c)) / 0.55, 0.0, 1.0);
  c *= 1.0 - pigment * 0.16 * (tooth - 0.3);
  // wet-in-wet: the wash is never even — broad soft blooms of more and less pigment
  float bloom = vnoise(pc / 140.0 + 2.0) * 0.6 + vnoise(pc / 55.0 + 8.0) * 0.4;
  c = mix(c, c * (0.9 + 0.2 * bloom), pigment);
  // the paper itself
  c *= 0.975 + 0.045 * tooth;

  // grade: keep the shadows a little cool, the light clean
  float l = luma(c);
  c *= mix(vec3(0.96, 0.97, 1.05), vec3(1.01, 1.0, 0.98), smoothstep(0.05, 0.55, l));

  // a faint vignette, like the light falling off across a sheet on a table
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  c *= 1.0 - 0.08 * smoothstep(0.4, 1.1, length(q));

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
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
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
