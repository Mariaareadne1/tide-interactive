import { clampWalkable, isWalkable, shoreZ, upBeach, WET_REACH } from '../scene/beach';
import { seededRandom } from '../scene/noise';
import type { WaveClock } from '../sea/waves';
import { isAlive, type SandLine } from '../sand/lines';
import { behave, DURATION, type BehaviourName } from './behaviours';
import { blendPose, ramp, type Pose } from './pose';
import { buildPath, longestRun, nearestOnPath, pointAt, type Path } from './path';

/**
 * One crab's mind. Plans (potter about, go and walk along a fresh line,
 * run from a wave or burrow under it, wave hello, stay dug in) decide where
 * it goes; behaviours (pure functions of time, cross-faded) decide how it
 * looks doing it. Crabs walk sideways: they turn so their side leads.
 * No three.js here, so it can be fuzzed and tested in Node.
 */

export interface CrabSpec {
  readonly id: number;
  readonly seed: number;
  readonly home: { x: number; z: number };
  /** Chance of burrowing (rather than running) when a wave comes. */
  readonly burrowiness: number;
}

export interface CrabWorld {
  readonly waves: WaveClock;
  line(id: number): SandLine | undefined;
  /** Other crabs' positions (for saying hello). */
  others(id: number): { x: number; z: number }[];
}

type Plan =
  | { kind: 'potter'; target: { x: number; z: number } | null; restUntil: number; activity: BehaviourName }
  | { kind: 'approach'; lineId: number; target: { x: number; z: number }; then: 'follow' | 'watch'; startAt: number; dir: 1 | -1 }
  | { kind: 'follow'; lineId: number; path: Path; at: number; dir: 1 | -1; pauseUntil: number; passed: number }
  | { kind: 'watch'; until: number }
  | { kind: 'wave'; until: number }
  | { kind: 'flee'; target: { x: number; z: number } }
  | { kind: 'hide'; since: number }
  | { kind: 'burrowed' }
  | { kind: 'emerge'; until: number; then: Plan | null }
  | { kind: 'held' };

export type CrabMode = Plan['kind'];

const SPEED = { potter: 0.38, approach: 0.95, follow: 0.42, flee: 1.75 };
const TURN_RATE = 6;
const CROSSFADE = 0.22;
/** How far ahead a crab watches the sea (s). */
const LOOKAHEAD = 1.5;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CrabController {
  x: number;
  z: number;
  /** Rotation about y: 0 faces the camera (+z); the crab's legs move it along its local x. */
  heading: number;
  /** Continuous leg-cycle phase. */
  phase = 0;
  /** Ground speed this frame (m/s). */
  speed = 0;
  pose: Pose;
  /** Asked to follow the next line drawn. */
  waitingForLine = false;
  /** Lines this crab has already walked (it won't walk them again on its own). */
  readonly walked = new Set<number>();
  /** Called when the plan's kind changes (the interface re-reads it). */
  onModeChange: (() => void) | null = null;
  /** Called when sand should puff up around the crab (burrowing, popping out). */
  onPuff: ((x: number, z: number, strength: number) => void) | null = null;

  private plan: Plan;
  private resume: Plan | null = null;
  private behaviour: BehaviourName = 'idle';
  private behaviourStart = 0;
  private prevBehaviour: BehaviourName = 'idle';
  private prevStart = 0;
  private fadeStart = -10;
  private readonly rand: () => number;
  private time = 0;

  constructor(readonly spec: CrabSpec) {
    this.x = spec.home.x;
    this.z = spec.home.z;
    this.rand = seededRandom(spec.seed * 7919 + 13);
    this.heading = (this.rand() - 0.5) * 1.2;
    this.plan = { kind: 'potter', target: null, restUntil: this.rand() * 2, activity: 'idle' };
    this.pose = behave('idle', 0, spec.seed);
  }

  get mode(): CrabMode {
    return this.plan.kind;
  }

  /** The line it is going to or walking along, if any. */
  get lineId(): number | null {
    const p = this.plan.kind === 'emerge' ? this.plan.then : this.plan;
    const r = p && (p.kind === 'approach' || p.kind === 'follow') ? p : this.resume;
    return r && (r.kind === 'approach' || r.kind === 'follow') ? r.lineId : null;
  }

  get burrowed(): boolean {
    return this.plan.kind === 'burrowed' || this.plan.kind === 'hide';
  }

  /** Free to go and look at a new line: not carried, not dug in or waving on request, not on a line already. */
  get available(): boolean {
    const k = this.plan.kind;
    return k !== 'held' && k !== 'burrowed' && k !== 'wave' && this.lineId === null;
  }

  private setPlan(plan: Plan): void {
    const changed = plan.kind !== this.plan.kind;
    this.plan = plan;
    if (changed) this.onModeChange?.();
  }

  private play(name: BehaviourName, t: number): void {
    if (name === this.behaviour) return;
    this.prevBehaviour = this.behaviour;
    this.prevStart = this.behaviourStart;
    this.behaviour = name;
    this.behaviourStart = t;
    this.fadeStart = t;
  }

  // --- requests ----------------------------------------------------------------

  /** Go and walk along this line, from its nearer end. */
  goFollow(line: SandLine, t: number): boolean {
    return this.goTo(line, 'follow', t);
  }

  /** Come and have a look at this line from beside it. */
  goWatch(line: SandLine, t: number): boolean {
    return this.goTo(line, 'watch', t);
  }

  private goTo(line: SandLine, then: 'follow' | 'watch', t: number): boolean {
    const path = buildPath(longestRun(line.points));
    if (!path) return false;
    this.waitingForLine = false;
    let target: { x: number; z: number };
    let startAt = 0;
    let dir: 1 | -1 = 1;
    if (then === 'follow') {
      const a = pointAt(path, 0), b = pointAt(path, path.length);
      const toB = Math.hypot(b.x - this.x, b.z - this.z) < Math.hypot(a.x - this.x, a.z - this.z);
      startAt = toB ? path.length : 0;
      dir = toB ? -1 : 1;
      target = toB ? b : a;
    } else {
      // stand a little to one side of the middle, on the crab's side
      const m = pointAt(path, path.length / 2);
      const side = (this.x - m.x) * -m.tz + (this.z - m.z) * m.tx > 0 ? 1 : -1;
      target = { x: m.x - m.tz * 0.32 * side, z: m.z + m.tx * 0.32 * side };
      const [cx, cz] = clampWalkable(target.x, target.z);
      target = { x: cx, z: cz };
    }
    const plan: Plan = { kind: 'approach', lineId: line.id, target, then, startAt, dir };
    if (this.plan.kind === 'hide' || this.plan.kind === 'flee' || this.plan.kind === 'burrowed') this.resume = plan;
    else this.setPlan(plan);
    this.play('look', t);
    return true;
  }

  waveClaws(t: number): void {
    if (this.plan.kind === 'burrowed' || this.plan.kind === 'hide') {
      this.surface(t, { kind: 'wave', until: t + 0.8 + DURATION.wave });
      return;
    }
    this.setPlan({ kind: 'wave', until: t + DURATION.wave });
  }

  toggleBurrow(t: number): void {
    if (this.plan.kind === 'burrowed') this.surface(t, null);
    else if (this.plan.kind !== 'held') this.dig(t, { kind: 'burrowed' });
  }

  private dig(t: number, plan: Plan): void {
    if (this.plan.kind === 'follow' || this.plan.kind === 'approach') this.resume = this.plan;
    this.setPlan(plan);
    this.play('burrow', t);
    this.onPuff?.(this.x, this.z, 1);
  }

  private surface(t: number, then: Plan | null): void {
    this.setPlan({ kind: 'emerge', until: t + DURATION.emerge, then });
    this.play('emerge', t);
    this.onPuff?.(this.x, this.z, 0.8);
  }

  grab(): void {
    this.resume = null;
    this.setPlan({ kind: 'held' });
  }

  dragTo(x: number, z: number): boolean {
    const ok = isWalkable(x, z);
    const [cx, cz] = ok ? [x, z] : clampWalkable(x, z);
    this.x = cx;
    this.z = cz;
    return ok;
  }

  release(t: number): void {
    // it settles where it was put, and potters about there from now on
    (this.spec.home as { x: number; z: number }).x = this.x;
    (this.spec.home as { x: number; z: number }).z = this.z;
    this.setPlan({ kind: 'potter', target: null, restUntil: t + 0.8, activity: 'look' });
  }

  // --- the frame -----------------------------------------------------------------

  update(dt: number, t: number, world: CrabWorld): void {
    this.time = t;
    const px = this.x, pz = this.z;
    this.watchTheSea(t, world);
    this.step(dt, t, world);
    this.speed = dt > 0 ? Math.hypot(this.x - px, this.z - pz) / dt : 0;
    // legs cycle with distance covered (and paddle in the air when held)
    this.phase += (this.plan.kind === 'held' ? 14 : this.speed * 38) * dt;

    const moving = this.speed > 0.06 && this.plan.kind !== 'held';
    if (moving && !this.burrowedish) this.play('walk', t);
    const local = (name: BehaviourName, start: number) => behave(name, t - start, this.spec.seed);
    let pose = local(this.behaviour, this.behaviourStart);
    const f = ramp(t - this.fadeStart, 0, CROSSFADE);
    if (f < 1) pose = blendPose(local(this.prevBehaviour, this.prevStart), pose, f);
    if (this.behaviour === 'walk') pose.gait = Math.min(1, this.speed / 0.3);
    this.pose = pose;
  }

  private get burrowedish(): boolean {
    return this.plan.kind === 'hide' || this.plan.kind === 'burrowed' || this.plan.kind === 'emerge';
  }

  /** Will the water reach this spot in the next moment? */
  private threatened(t: number, waves: WaveClock, margin: number): boolean {
    const u = upBeach(this.x, this.z);
    for (let k = 0; k <= 5; k++) {
      const dt = (k / 5) * LOOKAHEAD;
      if (waves.front(this.x, t + dt) > u - margin) return true;
    }
    return false;
  }

  private watchTheSea(t: number, world: CrabWorld): void {
    const k = this.plan.kind;
    if (k === 'held' || k === 'burrowed' || k === 'emerge') return;
    const waves = world.waves;
    const u = upBeach(this.x, this.z);
    if (k === 'hide') {
      // come back up once the water has drawn well back and the next wave isn't on its way
      if (t - this.plan.since > 1.6 && waves.front(this.x, t) < u - 0.35 && !this.threatened(t, waves, 0.2)) this.surface(t, this.takeResume());
      return;
    }
    if (k === 'flee') {
      if (waves.front(this.x, t) > u - 0.05) this.hide(t); // caught: dig in where it stands
      return;
    }
    if (!this.threatened(t, waves, 0.25)) return;
    // keep what it was doing, to carry on afterwards
    if (k === 'follow' || k === 'approach') this.resume = this.plan;
    const wave = waves.at(t + LOOKAHEAD) ?? waves.at(t);
    const reach = (wave?.reach ?? 1) * 1.17 + 0.45 + this.rand() * 0.3;
    const tx = this.x + (this.rand() - 0.5) * 0.6;
    const tz = shoreZ(tx) - reach;
    const wet = u < WET_REACH + 0.4;
    if ((wet && this.rand() < this.spec.burrowiness) || !isWalkable(tx, tz)) this.hide(t);
    else this.setPlan({ kind: 'flee', target: { x: tx, z: tz } });
  }

  private hide(t: number): void {
    this.dig(t, { kind: 'hide', since: t });
  }

  private takeResume(): Plan | null {
    const r = this.resume;
    this.resume = null;
    return r;
  }

  private step(dt: number, t: number, world: CrabWorld): void {
    const plan = this.plan;
    switch (plan.kind) {
      case 'potter': return this.potter(plan, dt, t, world);
      case 'approach': {
        const line = world.line(plan.lineId);
        if (!line || !isAlive(line)) return this.idle(t);
        if (this.walkToward(plan.target.x, plan.target.z, SPEED.approach, dt)) {
          if (plan.then === 'watch') {
            const path = buildPath(longestRun(line.points));
            if (path) {
              const m = pointAt(path, path.length / 2);
              this.heading = Math.atan2(m.x - this.x, m.z - this.z);
            }
            this.setPlan({ kind: 'watch', until: t + DURATION.wave + 0.6 });
            this.play('wave', t);
            return;
          }
          const path = buildPath(longestRun(line.points));
          if (!path) return this.idle(t);
          const near = nearestOnPath(path, this.x, this.z);
          const dir: 1 | -1 = near.at > path.length / 2 ? -1 : 1;
          const on = pointAt(path, near.at);
          this.x = on.x;
          this.z = on.z;
          this.setPlan({ kind: 'follow', lineId: line.id, path, at: near.at, dir, pauseUntil: t + 0.7, passed: -1 });
          this.play('look', t);
        }
        return;
      }
      case 'follow': return this.follow(plan, dt, t, world);
      case 'watch':
        if (t > plan.until) this.idle(t);
        return;
      case 'wave':
        this.turnToward(0, dt);
        this.play('wave', t);
        if (t > plan.until) this.idle(t);
        return;
      case 'flee':
        if (this.walkToward(plan.target.x, plan.target.z, SPEED.flee, dt)) {
          // wait it out up the beach, eyes on the water
          this.setPlan({ kind: 'potter', target: null, restUntil: t + 2.5, activity: 'look' });
          this.play('look', t);
          const r = this.takeResume();
          if (r) this.resume = r;
        }
        return;
      case 'hide':
        if (t - this.behaviourStart > DURATION.burrow) this.play('buried', t);
        return;
      case 'burrowed':
        if (this.behaviour === 'burrow' && t - this.behaviourStart > DURATION.burrow) this.play('buried', t);
        return;
      case 'emerge':
        if (t > plan.until) {
          const next = plan.then ?? this.takeResume();
          if (next && (next.kind === 'approach' || next.kind === 'follow')) {
            const line = world.line(next.lineId);
            if (line && isAlive(line)) {
              this.resumeLine(line, next, t);
              return;
            }
          }
          if (next?.kind === 'wave') {
            this.setPlan(next);
            return;
          }
          this.idle(t);
        }
        return;
      case 'held':
        this.play('held', t);
        return;
    }
  }

  /** Pick a line back up after a wave, wherever it now is. */
  private resumeLine(line: SandLine, prev: Plan, t: number): void {
    if (prev.kind === 'approach' && prev.then === 'watch') {
      this.goWatch(line, t);
      return;
    }
    this.goFollow(line, t);
  }

  private idle(t: number): void {
    this.setPlan({ kind: 'potter', target: null, restUntil: t + 1 + this.rand() * 2.5, activity: 'idle' });
    this.play('idle', t);
  }

  private potter(plan: Extract<Plan, { kind: 'potter' }>, dt: number, t: number, world: CrabWorld): void {
    if (plan.target) {
      if (this.walkToward(plan.target.x, plan.target.z, SPEED.potter, dt)) {
        plan.target = null;
        plan.restUntil = t + 1.5 + this.rand() * 2.8;
        const r = this.rand();
        // now and then, a hello to a neighbour
        const near = world.others(this.spec.id).find((o) => Math.hypot(o.x - this.x, o.z - this.z) < 1.4);
        if (near && r < 0.35) {
          this.heading = this.heading + wrap(Math.atan2(near.x - this.x, near.z - this.z) - this.heading) * 0.8;
          plan.activity = 'wave';
        } else {
          plan.activity = r < 0.55 ? 'idle' : r < 0.8 ? 'dig' : 'look';
        }
        this.play(plan.activity, t);
      }
      return;
    }
    if (this.behaviour === 'walk') this.play(plan.activity, t);
    if (t < plan.restUntil) return;
    // back to the line it left when the wave came, if the sea has left any of it
    const r = this.takeResume();
    if (r && (r.kind === 'approach' || r.kind === 'follow')) {
      const line = world.line(r.lineId);
      if (line && isAlive(line)) {
        this.resumeLine(line, r, t);
        return;
      }
    }
    // a short wander near home, staying out of the water
    for (let k = 0; k < 12; k++) {
      const a = this.rand() * Math.PI * 2, r = 0.3 + this.rand() * 1.4;
      const x = this.spec.home.x + Math.cos(a) * r, z = this.spec.home.z + Math.sin(a) * r * 0.8;
      if (isWalkable(x, z) && upBeach(x, z) > 0.4) {
        plan.target = { x, z };
        return;
      }
    }
    plan.restUntil = t + 1;
  }

  private follow(plan: Extract<Plan, { kind: 'follow' }>, dt: number, t: number, world: CrabWorld): void {
    const line = world.line(plan.lineId);
    if (!line || !isAlive(line)) return this.idle(t);
    if (t < plan.pauseUntil) return;
    const next = plan.at + plan.dir * SPEED.follow * dt;
    // the sea may have worn part of the line away: stop where it ends
    const p = pointAt(plan.path, next);
    const strength = this.strengthNear(line, p.x, p.z);
    const end = next <= 0 || next >= plan.path.length || strength < 0.2;
    // a corner: stop and look
    const corner = plan.path.corners.findIndex((c, i) => i !== plan.passed && (c - plan.at) * plan.dir >= 0 && (c - next) * plan.dir <= 0);
    plan.at = Math.min(plan.path.length, Math.max(0, next));
    const q = pointAt(plan.path, plan.at);
    this.x = q.x;
    this.z = q.z;
    // sideways: the body's local x runs along the line
    const h = Math.atan2(-q.tz, q.tx);
    this.turnToward(Math.abs(wrap(h - this.heading)) < Math.PI / 2 ? h : h + Math.PI, dt);
    if (corner >= 0) {
      plan.passed = corner;
      plan.pauseUntil = t + 0.75;
      this.play('look', t);
      return;
    }
    if (end) {
      this.walked.add(line.id);
      this.setPlan({ kind: 'potter', target: null, restUntil: t + 1.6, activity: 'look' });
      this.play('look', t);
    }
  }

  private strengthNear(line: SandLine, x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (const p of line.points) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p.s;
      }
    }
    return best;
  }

  private turnToward(target: number, dt: number): void {
    const d = wrap(target - this.heading);
    this.heading += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt);
  }

  /** Scuttle sideways toward a point. Returns true on arrival. */
  private walkToward(tx: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.03) return true;
    // local +x in world is (cos h, -sin h): lead with whichever side needs less turning
    const h = Math.atan2(-dz, dx);
    const target = Math.abs(wrap(h - this.heading)) < Math.PI / 2 ? h : h + Math.PI;
    this.turnToward(target, dt);
    const align = Math.abs(Math.cos(wrap(target - this.heading)));
    const move = Math.min(dist, speed * dt * (0.25 + 0.75 * align));
    this.x += (dx / dist) * move;
    this.z += (dz / dist) * move;
    return dist - move < 0.03;
  }

  /** Seconds since the controller started (for debugging). */
  get now(): number {
    return this.time;
  }
}
