import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise3 } from '../scene/noise';
import { paintMaterial, tint, withAO } from '../scene/paint';
import { SHADOW_LAYER } from '../engine/shadows';
import { terrainHeight } from '../scene/beach';
import type { WorldUniforms } from '../scene/world';
import type { Pose } from './pose';
import { CRAB_SCALE, HIPS, legPhase } from './anatomy';

/**
 * A small painted crab: a rounded shell in coral or sand tones, freckled
 * and pale underneath, tiny dark eyes on stalks, two claws and eight
 * jointed legs. Its parts are posed every frame from the controller's pose
 * and leg phase — squash and stretch on the body, a quick sideways leg
 * cycle, claws that lift and pinch.
 */

export interface CrabColours {
  shell: string;
  rim: string;
  leg: string;
  tip: string;
}

export const CRAB_COLOURS: CrabColours[] = [
  { shell: '#f0523a', rim: '#c23626', leg: '#f6765c', tip: '#6e2218' },
  { shell: '#f47a2c', rim: '#c95516', leg: '#f99a5a', tip: '#6e3210' },
  { shell: '#e8455c', rim: '#b52c42', leg: '#f06a7c', tip: '#661c28' },
  { shell: '#ff6a4a', rim: '#d0442c', leg: '#ff8c70', tip: '#702818' },
];

/** Disco frames, one per crab colour. */
const SHADES_FRAMES = ['#ff5aa5', '#f7d24a', '#5ad1ff', '#f4f1ea'];

const BODY_Y = 0.055;
const SINK = 0.135;
const FEMUR = 0.075;
const TIBIA = 0.105;

const caster = (m: THREE.Mesh) => {
  m.layers.enable(SHADOW_LAYER);
  return m;
};

function prep(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  return tint(n, hex);
}

/** A capsule lying along +x from the origin. */
function limb(radius: number, length: number, hex: string, taper = 1): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, length, 3, 8);
  g.rotateZ(-Math.PI / 2);
  g.translate(length / 2, 0, 0);
  if (taper !== 1) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 1 - (1 - taper) * Math.min(1, Math.max(0, p.getX(i) / length));
      p.setY(i, p.getY(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
  }
  return prep(g, hex);
}

function shellGeometry(c: CrabColours, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 30, 18);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const colours = new Float32Array(p.count * 3);
  const shell = new THREE.Color(c.shell), rim = new THREE.Color(c.rim), belly = new THREE.Color('#f3dfc4');
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // a flat belly, a domed back with a soft ridge, a front edge notched between the eyes
    if (y < 0) y *= 0.45;
    y *= 1 + 0.12 * Math.exp(-(x * x) * 6) * Math.max(0, y);
    const front = Math.max(0, z) * Math.exp(-(x * x) * 30) * 0.12;
    z -= front;
    x *= 1 + 0.05 * Math.cos(z * 3);
    p.setXYZ(i, x * 0.175, y * 0.06, z * 0.13);
    const up = Math.max(0, y);
    col.copy(rim).lerp(shell, Math.min(1, up * 2.2));
    // a pale sheen on the crown of the shell
    col.lerp(new THREE.Color('#fbe3cf'), Math.max(0, up - 0.75) * 1.4);
    // freckles
    if (noise3(x * 6 + seed, y * 6, z * 6) > 0.5 && up > 0.2) col.multiplyScalar(0.8);
    if (y < -0.05) col.copy(belly);
    colours.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.computeVertexNormals();
  const out = g.toNonIndexed();
  out.deleteAttribute('uv');
  return withAO(out);
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  side: 1 | -1;
  index: number;
}

interface Claw {
  shoulder: THREE.Group;
  wrist: THREE.Group;
  finger: THREE.Group;
  side: 1 | -1;
}

export class CrabView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly claws: Claw[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly shades = new THREE.Group();
  private readonly eyeTop = new THREE.Vector3();
  private readonly materials: THREE.ShaderMaterial[];

  constructor(world: WorldUniforms, colours: CrabColours, readonly seed: number, readonly size = 1) {
    const mat = paintMaterial(world, { vertexColors: true, softness: 0.16, gloss: 0.45, shadeTint: '#d8c4e0' });
    const dark = paintMaterial(world, { color: '#2b2422', softness: 0.1, gloss: 1.2 });
    this.materials = [mat, dark];
    this.root.add(this.body);
    this.root.scale.setScalar(CRAB_SCALE * size);

    const shell = caster(new THREE.Mesh(shellGeometry(colours, seed), mat));
    this.body.add(shell);

    // eyes on stalks, at the front edge
    for (const side of [-1, 1] as const) {
      const stalk = new THREE.Group();
      stalk.position.set(side * 0.036, 0.035, 0.1);
      const stem = new THREE.CapsuleGeometry(0.008, 0.045, 3, 6);
      stem.translate(0, 0.0225, 0);
      stalk.add(caster(new THREE.Mesh(prep(stem, colours.leg), mat)));
      const eye = caster(new THREE.Mesh(withAO(new THREE.SphereGeometry(0.016, 12, 9)), dark));
      eye.position.y = 0.05;
      stalk.add(eye);
      const glint = new THREE.Mesh(withAO(new THREE.SphereGeometry(0.0045, 6, 4)), paintMaterial(world, { color: '#ffffff', softness: 0.6 }));
      glint.position.set(side * 0.004, 0.058, 0.012);
      stalk.add(glint);
      this.materials.push(glint.material as THREE.ShaderMaterial);
      this.body.add(stalk);
      this.eyes.push(stalk);
    }

    // sunglasses, for the dance: two dark lenses on a bright frame, worn on the eye stalks
    const lensMat = paintMaterial(world, { color: '#17161c', softness: 0.08, gloss: 1.6 });
    const frameMat = paintMaterial(world, { color: SHADES_FRAMES[seed % SHADES_FRAMES.length], softness: 0.3, gloss: 0.8 });
    this.materials.push(lensMat, frameMat);
    for (const side of [-1, 1]) {
      // big, slightly too big — that's the look
      const rim = new THREE.TorusGeometry(0.032, 0.007, 6, 20);
      rim.scale(1.2, 0.95, 1);
      const r = caster(new THREE.Mesh(withAO(rim), frameMat));
      r.position.x = side * 0.047;
      const lens = new THREE.CylinderGeometry(0.032, 0.032, 0.006, 20);
      lens.rotateX(Math.PI / 2);
      lens.scale(1.2, 0.95, 1);
      const l = caster(new THREE.Mesh(withAO(lens), lensMat));
      l.position.x = side * 0.047;
      this.shades.add(r, l);
    }
    const bridge = new THREE.CapsuleGeometry(0.006, 0.02, 3, 6);
    bridge.rotateZ(Math.PI / 2);
    const br = new THREE.Mesh(withAO(bridge), frameMat);
    br.position.y = 0.01;
    this.shades.add(br);
    this.shades.visible = false;
    this.body.add(this.shades);

    // claws: an arm forward and out, a plump palm, a fixed and a moving finger
    for (const side of [-1, 1] as const) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.1, 0.005, 0.085);
      shoulder.rotation.y = side * 0.55;
      const arm = limb(0.019, 0.06, colours.leg, 0.85);
      arm.rotateY(-Math.PI / 2); // along +z
      shoulder.add(caster(new THREE.Mesh(arm, mat)));
      const wrist = new THREE.Group();
      wrist.position.z = 0.065;
      const palm = new THREE.SphereGeometry(1, 14, 10);
      palm.scale(0.04, 0.032, 0.05);
      palm.translate(0, 0, 0.032);
      const fixed = new THREE.ConeGeometry(0.013, 0.05, 8);
      fixed.rotateX(Math.PI / 2);
      fixed.translate(-side * 0.012, 0, 0.09);
      wrist.add(caster(new THREE.Mesh(mergeGeometries([prep(palm, colours.shell), prep(fixed, colours.tip)]), mat)));
      const finger = new THREE.Group();
      finger.position.set(side * 0.014, 0.004, 0.06);
      const moving = new THREE.ConeGeometry(0.011, 0.05, 8);
      moving.rotateX(Math.PI / 2);
      moving.translate(0, 0, 0.024);
      finger.add(caster(new THREE.Mesh(prep(moving, colours.tip), mat)));
      wrist.add(finger);
      shoulder.add(wrist);
      this.body.add(shoulder);
      this.claws.push({ shoulder, wrist, finger, side });
    }

    // eight jointed legs, four a side
    const femurGeo = limb(0.017, FEMUR, colours.leg, 0.8);
    const tibiaGeo = mergeGeometries([limb(0.014, TIBIA, colours.leg, 0.45), limb(0.006, 0.022, colours.tip).translate(TIBIA - 0.014, 0, 0)]);
    for (const side of [1, -1] as const) {
      HIPS.forEach((h, index) => {
        const mount = new THREE.Group();
        mount.position.set(side * 0.12, 0, h.z);
        mount.rotation.y = side > 0 ? 0 : Math.PI;
        const hip = new THREE.Group();
        hip.add(caster(new THREE.Mesh(femurGeo, mat)));
        const knee = new THREE.Group();
        knee.position.x = FEMUR;
        knee.add(caster(new THREE.Mesh(tibiaGeo, mat)));
        hip.add(knee);
        mount.add(hip);
        this.body.add(mount);
        this.legs.push({ hip, knee, side, index });
      });
    }
  }

  setHighlight(v: number): void {
    for (const m of this.materials) m.uniforms.uHighlight.value = v;
  }

  apply(x: number, z: number, heading: number, phase: number, pose: Pose, time: number): void {
    this.root.position.set(x, terrainHeight(x, z), z);
    this.root.rotation.y = heading;
    const b = this.body;
    b.position.y = BODY_Y + pose.bob - pose.burrow * SINK;
    const sq = pose.squash;
    b.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    b.rotation.set(pose.pitch, 0, pose.roll);

    this.eyes.forEach((e, i) => {
      e.scale.y = 0.35 + 0.65 * Math.max(0, pose.eyes);
      e.rotation.set(-0.15, pose.look, (i ? -1 : 1) * 0.12);
    });

    // the sunglasses sit just in front of the eyes, sliding down from above as they go on
    const on = pose.shades;
    this.shades.visible = on > 0.01;
    if (this.shades.visible) {
      const stalk = this.eyes[0];
      stalk.updateMatrix();
      this.eyeTop.set(0, 0.05, 0).applyMatrix4(stalk.matrix);
      this.shades.position.set(0, this.eyeTop.y + (1 - on) * 0.07, this.eyeTop.z + 0.017);
      this.shades.scale.setScalar(0.7 + 0.3 * on);
    }

    this.claws.forEach((c) => {
      const raise = c.side < 0 ? pose.clawL : pose.clawR;
      const pinch = c.side < 0 ? pose.pinchL : pose.pinchR;
      c.shoulder.rotation.x = -0.2 - raise * 1.25;
      c.wrist.rotation.x = 0.35 - raise * 0.5;
      c.finger.rotation.y = c.side * (0.05 + pinch * 0.55);
    });

    for (const leg of this.legs) {
      const fan = HIPS[leg.index].fan;
      // alternating sets of legs, the two sides half a cycle apart: a quick sideways scuttle
      const ph = legPhase(phase, leg);
      const swing = 0.32 * pose.gait * Math.sin(ph);
      let lift = 0.42 * pose.gait * Math.max(0, Math.cos(ph));
      lift += pose.dig * 0.45 * Math.max(0, Math.sin(time * 24 + leg.index * 1.7 + (leg.side > 0 ? 0 : 1.3)));
      // tucked in when buried
      const tuck = pose.burrow * 0.5;
      leg.hip.rotation.set(0, -fan * leg.side + swing, 0.45 + lift + tuck * 0.4);
      leg.knee.rotation.z = -1.75 - lift * 0.4 + tuck * 0.3;
    }
  }

  /** World bounds of the crab (for the selection box). */
  bounds(box: THREE.Box3): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    return box.setFromObject(this.root);
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
  }
}
