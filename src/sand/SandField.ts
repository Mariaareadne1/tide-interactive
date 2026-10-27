import * as THREE from 'three';
import { TILE } from '../scene/beach';
import { BEACH_GLSL, GROOVE_GLSL } from '../scene/beachGlsl';
import { NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import { DIFFUSE_RATE, ERODE_RATE, GROOVE_HALF_WIDTH } from './groove';
import type { WorldUniforms } from '../scene/world';

/**
 * The wet sand as a GPU heightmap over the whole tile (ping-pong render
 * targets). Channels: r groove depth, g pushed-up lip, b wetness left by
 * the last wave, a foam caught in the grooves.
 *
 *   stamp   — a fingertip pressing a line: segments max-blended into the
 *             current target, scissored to their bounds, so it is cheap
 *             and never deepens a groove by drawing over it twice
 *   evolve  — once a frame: where the sea covers the sand, grooves smear
 *             and flatten; wet sand dries; foam lingers in grooves and fades
 *   restore — undo: inside the undone line's footprint the sand eases back
 *             to how it was before the line was drawn
 */

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  pressure: number;
}

const MAX_SEGMENTS = 64;
const MAX_SNAPSHOTS = 8;

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const stampFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${BEACH_GLSL}
${GROOVE_GLSL}
uniform vec4 uSeg[${MAX_SEGMENTS}];
uniform float uPress[${MAX_SEGMENTS}];
uniform int uCount;
uniform float uWiden; // > 1 paints a footprint mask instead of a groove
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * vec2(HALF_X, HALF_Z);
  float wet = 1.0 - smoothstep(WET_REACH * 0.55, WET_REACH, upBeach(p));
  // dry sand crumbles: the edge of the line wanders grain by grain
  float crumble = (vnoise(p * 55.0) - 0.5) * GROOVE_HW * 0.7 * (1.0 - wet);
  vec2 best = vec2(0.0);
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uCount) break;
    float d = segDist(p, uSeg[i].xy, uSeg[i].zw);
    if (uWiden > 1.0) {
      best.x = max(best.x, smoothstep(GROOVE_HW * uWiden, GROOVE_HW * uWiden * 0.6, d));
    } else {
      best = max(best, grooveProfile(d + crumble, wet, uPress[i]));
    }
  }
  gl_FragColor = vec4(best, 0.0, 0.0);
}
`;

const evolveFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${BEACH_GLSL}
uniform sampler2D uPrev;
uniform sampler2D uSnap;
uniform sampler2D uMask;
uniform float uRestoreK;
uniform float uDt;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uPrev, vUv);
  vec2 p = (vUv * 2.0 - 1.0) * vec2(HALF_X, HALF_Z);
  float cover = waveCover(p);
  vec2 t = uSandTexel;
  vec2 blur = (texture2D(uPrev, vUv + vec2(t.x, 0.0)).rg + texture2D(uPrev, vUv - vec2(t.x, 0.0)).rg
             + texture2D(uPrev, vUv + vec2(0.0, t.y)).rg + texture2D(uPrev, vUv - vec2(0.0, t.y)).rg) * 0.25;
  vec2 rg = c.rg + (min(blur, c.rg) - c.rg) * min(1.0, cover * ${DIFFUSE_RATE.toFixed(3)} * uDt);
  rg *= exp(-${ERODE_RATE.toFixed(3)} * cover * uDt);
  // the sand stays glossy where the water was, then dries over a few seconds
  float wet = max(c.b - uDt / 6.5, smoothstep(0.0, 0.3, cover));
  // foam gathers in grooves while the water is over them and lingers as it drains
  float foam = max(c.a * exp(-uDt / 3.0), cover * smoothstep(0.05, 0.4, c.r) * step(0.4, uWaveTau));
  if (uRestoreK > 0.0) {
    float m = texture2D(uMask, vUv).r;
    rg = mix(rg, texture2D(uSnap, vUv).rg, m * uRestoreK);
  }
  gl_FragColor = vec4(rg, wet, foam);
}
`;

const copyFragment = /* glsl */ `
uniform sampler2D uSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uSrc, vUv); }
`;

interface Snapshot {
  lineId: number;
  target: THREE.WebGLRenderTarget;
}

interface Restore {
  snap: THREE.WebGLRenderTarget;
  time: number;
}

export class SandField {
  readonly cols: number;
  readonly rows: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly mask: THREE.WebGLRenderTarget;
  private readonly snapshots: Snapshot[] = [];
  private readonly free: THREE.WebGLRenderTarget[] = [];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly stampMat: THREE.ShaderMaterial;
  private readonly evolveMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly pending: Segment[] = [];
  private restore: Restore | null = null;
  /** Set when the targets need clearing (first frame, context restored). */
  private dirty = true;

  constructor(private readonly world: WorldUniforms, size: 'high' | 'low') {
    this.cols = size === 'high' ? 1024 : 768;
    this.rows = Math.round(this.cols * (TILE.halfZ / TILE.halfX));
    const make = () =>
      new THREE.WebGLRenderTarget(this.cols, this.rows, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
    this.targets = [make(), make()];
    this.mask = new THREE.WebGLRenderTarget(this.cols, this.rows, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    world.uSandTexel.value.set(1 / this.cols, 1 / this.rows);

    this.stampMat = new THREE.ShaderMaterial({
      uniforms: {
        ...world,
        uSeg: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        uPress: { value: new Array(MAX_SEGMENTS).fill(1) },
        uCount: { value: 0 },
        uWiden: { value: 1 },
      },
      vertexShader: quadVertex,
      fragmentShader: stampFragment,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.evolveMat = new THREE.ShaderMaterial({
      uniforms: {
        ...world,
        uPrev: { value: null },
        uSnap: { value: null },
        uMask: { value: this.mask.texture },
        uRestoreK: { value: 0 },
        uDt: { value: 0 },
      },
      vertexShader: quadVertex,
      fragmentShader: evolveFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null } },
      vertexShader: quadVertex,
      fragmentShader: copyFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.evolveMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    world.uSand.value = this.targets[0].texture;
  }

  get current(): THREE.WebGLRenderTarget {
    return this.targets[0];
  }

  /** Queue segments of a line being pressed; they reach the sand on the next frame. */
  stamp(segments: readonly Segment[]): void {
    this.pending.push(...segments);
  }

  /** Keep a copy of the sand as it is before line `lineId` (for undo). */
  snapshot(renderer: THREE.WebGLRenderer, lineId: number): void {
    this.flush(renderer);
    if (this.snapshots.length >= MAX_SNAPSHOTS) this.free.push(this.snapshots.shift()!.target);
    const target =
      this.free.pop() ??
      new THREE.WebGLRenderTarget(this.cols, this.rows, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.blit(renderer, this.copyMat, this.current.texture, target);
    this.snapshots.push({ lineId, target });
  }

  hasSnapshot(lineId: number): boolean {
    return this.snapshots.some((s) => s.lineId === lineId);
  }

  /** Ease the sand back over a line: its footprint returns to the snapshot taken before it. */
  undo(renderer: THREE.WebGLRenderer, lineId: number, segments: readonly Segment[]): boolean {
    const i = this.snapshots.findIndex((s) => s.lineId === lineId);
    if (i < 0) return false;
    this.flush(renderer);
    this.finishRestore();
    // paint the footprint mask, a little wider than the line and its lip
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    this.drawSegments(renderer, segments, this.mask, 2.6);
    const [snap] = this.snapshots.splice(i, 1);
    this.restore = { snap: snap.target, time: 0 };
    return true;
  }

  /** Forget snapshots for lines the sea has touched (they can no longer be undone). */
  dropSnapshot(lineId: number): void {
    const i = this.snapshots.findIndex((s) => s.lineId === lineId);
    if (i >= 0) this.free.push(this.snapshots.splice(i, 1)[0].target);
  }

  private finishRestore(): void {
    if (!this.restore) return;
    this.free.push(this.restore.snap);
    this.restore = null;
  }

  /** Write queued stamps into the sand. */
  flush(renderer: THREE.WebGLRenderer): void {
    if (this.dirty) this.clear(renderer);
    if (!this.pending.length) return;
    const segs = this.pending.splice(0);
    this.drawSegments(renderer, segs, this.current, 1);
  }

  private drawSegments(renderer: THREE.WebGLRenderer, segs: readonly Segment[], target: THREE.WebGLRenderTarget, widen: number): void {
    const u = this.stampMat.uniforms;
    u.uWiden.value = widen;
    this.quad.material = this.stampMat;
    const prevScissor = renderer.getScissorTest();
    // stamps blend into what is there: never clear first
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.setScissorTest(true);
    for (let start = 0; start < segs.length; start += MAX_SEGMENTS) {
      const batch = segs.slice(start, start + MAX_SEGMENTS);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      batch.forEach((s, i) => {
        u.uSeg.value[i].set(s.ax, s.az, s.bx, s.bz);
        u.uPress.value[i] = s.pressure;
        minX = Math.min(minX, s.ax, s.bx); maxX = Math.max(maxX, s.ax, s.bx);
        minZ = Math.min(minZ, s.az, s.bz); maxZ = Math.max(maxZ, s.az, s.bz);
      });
      u.uCount.value = batch.length;
      const pad = GROOVE_HALF_WIDTH * 3.5 * widen;
      const x0 = Math.max(0, Math.floor(((minX - pad) / TILE.halfX + 1) / 2 * this.cols));
      const x1 = Math.min(this.cols, Math.ceil(((maxX + pad) / TILE.halfX + 1) / 2 * this.cols));
      const y0 = Math.max(0, Math.floor(((minZ - pad) / TILE.halfZ + 1) / 2 * this.rows));
      const y1 = Math.min(this.rows, Math.ceil(((maxZ + pad) / TILE.halfZ + 1) / 2 * this.rows));
      if (x1 <= x0 || y1 <= y0) continue;
      target.scissor.set(x0, y0, x1 - x0, y1 - y0);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
    }
    target.scissorTest = false;
    renderer.setScissorTest(prevScissor);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(null);
    this.quad.material = this.evolveMat;
  }

  /** One frame of the sea working on the sand. */
  evolve(renderer: THREE.WebGLRenderer, dt: number): void {
    this.flush(renderer);
    if (dt <= 0) return;
    const u = this.evolveMat.uniforms;
    u.uPrev.value = this.current.texture;
    u.uDt.value = dt;
    if (this.restore) {
      this.restore.time += dt;
      u.uSnap.value = this.restore.snap.texture;
      u.uRestoreK.value = Math.min(1, dt * 9);
    } else {
      u.uRestoreK.value = 0;
    }
    this.blit(renderer, this.evolveMat, null, this.targets[1]);
    this.targets = [this.targets[1], this.targets[0]];
    this.world.uSand.value = this.current.texture;
    if (this.restore && this.restore.time > 0.6) this.finishRestore();
  }

  private blit(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, src: THREE.Texture | null, target: THREE.WebGLRenderTarget): void {
    if (src) mat.uniforms.uSrc.value = src;
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    this.quad.material = this.evolveMat;
  }

  /** Smooth, dry sand everywhere (start, and after the graphics context is restored). */
  clear(renderer: THREE.WebGLRenderer): void {
    this.dirty = false;
    const prev = new THREE.Color();
    renderer.getClearColor(prev);
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of [...this.targets, this.mask]) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prev, alpha);
    this.pending.length = 0;
    for (const s of this.snapshots.splice(0)) this.free.push(s.target);
    this.finishRestore();
  }

  /** Mark for clearing on the next frame (the GPU copy was lost). */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Read the sand back (tests and QA): channel values at world points.
   * Slow — a GPU sync per call.
   */
  read(renderer: THREE.WebGLRenderer, points: readonly { x: number; z: number }[]): { depth: number; lip: number; wet: number; foam: number }[] {
    this.flush(renderer);
    const buf = new Uint16Array(4);
    return points.map(({ x, z }) => {
      const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x / TILE.halfX + 1) / 2 * this.cols)));
      const r = Math.min(this.rows - 1, Math.max(0, Math.floor((z / TILE.halfZ + 1) / 2 * this.rows)));
      renderer.readRenderTargetPixels(this.current, c, r, 1, 1, buf);
      const h = (i: number) => THREE.DataUtils.fromHalfFloat(buf[i]);
      return { depth: h(0), lip: h(1), wet: h(2), foam: h(3) };
    });
  }

  dispose(): void {
    for (const t of [...this.targets, this.mask, ...this.free, ...this.snapshots.map((s) => s.target)]) t.dispose();
    this.restore?.snap.dispose();
    this.stampMat.dispose();
    this.evolveMat.dispose();
    this.copyMat.dispose();
    this.quad.geometry.dispose();
  }
}
