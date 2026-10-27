import * as THREE from 'three';

/**
 * One light rig shared by every material. The look is painted rather than
 * photographic: a warm late-morning sun over a soft two-tone ramp, with
 * shade that turns cool lavender instead of simply darker. Colours are
 * linear-light. Also carries the sea's current state and the sand
 * heightmap, which the beach, the stamp passes and the crabs all read.
 */

// THREE.Color parses hex as sRGB and stores linear values (ColorManagement is on).
const linear = (hex: string) => new THREE.Color(hex);

export const PAPER_HEX = '#f4efe4';
export const MAX_RIPPLES = 6;

const SUN = new THREE.Vector3(-0.58, 0.74, 0.34).normalize();
export const SUN_DIR = SUN.clone();

export interface WorldUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uShadeColor: THREE.IUniform<THREE.Color>;
  uPaper: THREE.IUniform<THREE.Color>;
  uShadowMap: THREE.IUniform<THREE.Texture | null>;
  uShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uShadowUvPerMeter: THREE.IUniform<number>;
  uShadowDepthRange: THREE.IUniform<number>;
  uShadowEnabled: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  uWet: THREE.IUniform<number>;
  uGolden: THREE.IUniform<number>;
  uWaveFront: THREE.IUniform<number>;
  uWavePhase: THREE.IUniform<THREE.Vector2>;
  uWaveTau: THREE.IUniform<number>;
  uWaveReach: THREE.IUniform<number>;
  uSand: THREE.IUniform<THREE.Texture | null>;
  uSandTexel: THREE.IUniform<THREE.Vector2>;
  /** Ripple rings on the water: x, z, start time, strength. */
  uRipples: THREE.IUniform<THREE.Vector4[]>;
  /** 0..1 calmer sea foam motion (reduced motion). */
  uCalm: THREE.IUniform<number>;
}

export function createWorldUniforms(): WorldUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: SUN.clone() },
    uSunColor: { value: linear('#fff6e6') },
    uShadeColor: { value: linear('#bdb9e3') },
    uPaper: { value: linear(PAPER_HEX) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowUvPerMeter: { value: 0.02 },
    uShadowDepthRange: { value: 40 },
    uShadowEnabled: { value: 0 },
    uWind: { value: 1 },
    uWet: { value: 0 },
    uGolden: { value: 0 },
    uWaveFront: { value: 0 },
    uWavePhase: { value: new THREE.Vector2() },
    uWaveTau: { value: 0 },
    uWaveReach: { value: 1 },
    uSand: { value: null },
    uSandTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uCalm: { value: 0 },
  };
}
