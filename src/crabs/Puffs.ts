import * as THREE from 'three';
import { terrainHeight } from '../scene/beach';

/**
 * Little puffs of sand kicked up when a crab digs in or pops out: a pool of
 * round painted grains that arc up and fall back. Pooled, so a busy beach
 * never allocates.
 */

const POOL = 240;
const LIFE = 0.9;

const vertex = /* glsl */ `
attribute float aAge;
attribute float aSize;
varying float vAge;
void main() {
  vAge = aAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (900.0 / -mv.z) * (1.0 - 0.4 * aAge);
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
varying float vAge;
void main() {
  if (vAge >= 1.0) discard;
  vec2 q = gl_PointCoord - 0.5;
  if (dot(q, q) > 0.25) discard;
  vec3 c = pow(vec3(0.88, 0.78, 0.6), vec3(2.2));
  gl_FragColor = vec4(c * (0.9 + 0.2 * q.y), 1.0);
}
`;

export class Puffs {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly age = new Float32Array(POOL).fill(1);
  private next = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1));
    const size = new Float32Array(POOL);
    for (let i = 0; i < POOL; i++) size[i] = 0.012 + ((i * 0.618) % 1) * 0.014;
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment }));
    this.points.frustumCulled = false;
    this.points.name = 'sand puffs';
  }

  burst(x: number, z: number, strength = 1): void {
    const n = Math.round(22 * strength);
    const y = terrainHeight(x, z);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const a = (k / n) * Math.PI * 2 + Math.sin(k * 7.3) * 0.5;
      const r = 0.08 + 0.06 * Math.abs(Math.sin(k * 3.1));
      this.pos.set([x + Math.cos(a) * r * 0.6, y + 0.02, z + Math.sin(a) * r * 0.6], i * 3);
      const sp = 0.35 + 0.35 * Math.abs(Math.sin(k * 5.7));
      this.vel.set([Math.cos(a) * sp, 0.7 + 0.6 * Math.abs(Math.cos(k * 2.3)), Math.sin(a) * sp], i * 3);
      this.age[i] = 0;
    }
  }

  update(dt: number): void {
    let live = false;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= 1) continue;
      live = true;
      this.age[i] = Math.min(1, this.age[i] + dt / LIFE);
      this.vel[i * 3 + 1] -= 4.5 * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      const floor = terrainHeight(this.pos[i * 3], this.pos[i * 3 + 2]);
      if (this.pos[i * 3 + 1] < floor) {
        this.pos[i * 3 + 1] = floor;
        this.vel[i * 3] *= 0.3;
        this.vel[i * 3 + 2] *= 0.3;
        this.vel[i * 3 + 1] = 0;
      }
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = live;
    g.getAttribute('aAge').needsUpdate = live;
    this.points.visible = live;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
