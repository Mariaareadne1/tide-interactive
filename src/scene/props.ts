import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROCKS, TILE, edgeDistance, highWaterU, rockDistance, shoreZ, terrainHeight, upBeach } from './beach';
import { noise3, seededRandom } from './noise';
import { paintMaterial, tint, withAO } from './paint';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * The beach's still life: a few rounded rocks (a cluster in the dunes, an
 * outcrop at the water's edge with a dark wet foot and a little weed),
 * pebbles scattered down the lower beach, and a ragged line of washed-up
 * seaweed at the high-water mark. All painted with the shared gouache
 * material and merged into a handful of draw calls.
 */

const caster = (m: THREE.Mesh) => {
  m.layers.enable(SHADOW_LAYER);
  return m;
};

/** A boulder: a squashed, lumpy sphere, its colour cooler and darker toward the foot. */
function rockGeometry(seed: number, r: number, h: number, wetFoot: boolean): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 6);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const top = new THREE.Color('#c9bfae');
  const mid = new THREE.Color('#a99f92');
  const foot = new THREE.Color(wetFoot ? '#6f6a63' : '#9a9184');
  const lichen = new THREE.Color('#c8c08a');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // soft facets: low-frequency lumps plus a few flat planes, like weathered granite
    const k = 1 + 0.16 * noise3(x * 1.4 + seed, y * 1.4, z * 1.4) + 0.06 * noise3(x * 4 + seed, y * 4, z * 4);
    const yy = y < 0 ? y * 0.25 : y;
    p.setXYZ(i, x * k * r, yy * k * h, z * k * r);
    const t = (yy + 0.25) / 1.25;
    c.copy(foot).lerp(mid, Math.min(1, t * 2)).lerp(top, Math.max(0, t * 1.4 - 0.4));
    if (!wetFoot && noise3(x * 5 + seed, y * 5, z * 5) > 0.45 && y > 0.2) c.lerp(lichen, 0.45);
    if (wetFoot && t < 0.3 && noise3(x * 6, y * 6 + seed, z * 6) > 0.1) c.lerp(new THREE.Color('#5d6b45'), 0.5);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return withAO(g);
}

function createRocks(world: WorldUniforms): THREE.Mesh {
  const parts = ROCKS.map((r) => {
    const wet = upBeach(r.x, r.z) < 2;
    const g = rockGeometry(r.seed, r.r, r.h, wet).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(r.x, terrainHeight(r.x, r.z) - 0.04, r.z);
    return g;
  });
  const mesh = caster(new THREE.Mesh(mergeGeometries(parts), paintMaterial(world, { vertexColors: true, softness: 0.18, gloss: 0.15, hatch: 1 })));
  mesh.name = 'rocks';
  return mesh;
}

/** Pebbles and a few shell fragments, scattered thickest on the lower beach. */
function createPebbles(world: WorldUniforms, density: number): THREE.Mesh {
  const rand = seededRandom(41);
  const parts: THREE.BufferGeometry[] = [];
  const colours = ['#b8ab98', '#9c958a', '#c9b9a1', '#8d8a85', '#d4c3ad', '#a58d78'];
  const count = Math.round(70 * density);
  let attempts = 0;
  while (parts.length < count && attempts++ < count * 30) {
    const x = (rand() * 2 - 1) * (TILE.halfX - 0.8);
    const z = (rand() * 2 - 1) * (TILE.halfZ - 0.8);
    const u = upBeach(x, z);
    if (u < 0.3 || edgeDistance(x, z) < 0.7 || rockDistance(x, z) < 0.1) continue;
    // thickest around the rocks and on the lower beach, sparse up by the dunes
    const want = 0.25 * Math.exp(-u / 2.5) + 0.8 * Math.exp(-Math.max(0, rockDistance(x, z)) * 1.6) + 0.05;
    if (rand() > want) continue;
    const s = 0.03 + rand() * 0.05;
    const g = new THREE.SphereGeometry(1, 9, 6).toNonIndexed();
    g.deleteAttribute('uv');
    g.scale(s * (1 + rand() * 0.5), s * 0.45, s);
    g.rotateY(rand() * Math.PI);
    g.translate(x, terrainHeight(x, z) + s * 0.1, z);
    parts.push(tint(g, colours[Math.floor(rand() * colours.length)]));
  }
  const mesh = caster(new THREE.Mesh(mergeGeometries(parts), paintMaterial(world, { vertexColors: true, softness: 0.2, gloss: 0.25 })));
  mesh.name = 'pebbles';
  return mesh;
}

/** Washed-up seaweed along the high-water mark: tangled dark ribbons, a little bladderwrack. */
function createSeaweed(world: WorldUniforms, density: number): THREE.Mesh {
  const rand = seededRandom(9);
  const parts: THREE.BufferGeometry[] = [];
  const colours = ['#5f5a32', '#6e6638', '#4f5230', '#7a6a3c', '#3f4a2e'];
  const n = Math.round(260 * density);
  for (let i = 0; i < n; i++) {
    const x = -TILE.halfX + 0.9 + rand() * (TILE.halfX * 2 - 1.8);
    // the line is broken: clumps, gaps
    if (Math.sin(x * 1.3 + 0.5) + Math.sin(x * 3.1) * 0.6 + rand() * 0.8 < 0.2) continue;
    const u = highWaterU(x) + (rand() - 0.5) * 0.45;
    const z = shoreZ(x) - u;
    if (edgeDistance(x, z) < 0.6 || rockDistance(x, z) < 0.1) continue;
    // a ribbon: a thin wavy strip lying on the sand
    const len = 0.12 + rand() * 0.3;
    const w = 0.012 + rand() * 0.02;
    const yaw = (rand() - 0.5) * 2.4;
    const seg = 8;
    const pos: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = k / seg, b = (k + 1) / seg;
      const wob = (t: number) => Math.sin(t * 9 + i) * 0.03;
      const ax = a * len, bx = b * len;
      pos.push(ax, 0, wob(a) - w, bx, 0, wob(b) - w, ax, 0, wob(a) + w);
      pos.push(ax, 0, wob(a) + w, bx, 0, wob(b) - w, bx, 0, wob(b) + w);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.rotateY(yaw);
    g.translate(x, terrainHeight(x, z) + 0.006 + rand() * 0.004, z);
    parts.push(tint(g, colours[Math.floor(rand() * colours.length)]));
    // now and then a knot of bladderwrack: little round floats
    if (rand() < 0.3) {
      const b = new THREE.SphereGeometry(0.018, 7, 5).toNonIndexed();
      b.deleteAttribute('uv');
      b.scale(1, 0.6, 1);
      b.translate(x + (rand() - 0.5) * 0.1, terrainHeight(x, z) + 0.01, z + (rand() - 0.5) * 0.1);
      parts.push(tint(b, '#6b5a2e'));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), paintMaterial(world, { vertexColors: true, softness: 0.3, side: THREE.DoubleSide }));
  mesh.name = 'seaweed';
  return mesh;
}

export function createProps(world: WorldUniforms, density = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  group.add(createRocks(world), createPebbles(world, density), createSeaweed(world, density));
  return group;
}
