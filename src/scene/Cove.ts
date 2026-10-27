import type { Engine } from '../engine/Engine';
import { createTerrain } from './terrain';
import { createDetails } from './details';
import { createProps } from './props';
import { createClouds, type Clouds } from './clouds';
import { WaveClock, frontProfile } from '../sea/waves';
import { SandField } from '../sand/SandField';

/**
 * The cove's fixed furniture — painted beach and sea, dune grass, rocks,
 * pebbles, seaweed, clouds — plus the two things that change: the sea's
 * rhythm (a pure function of time) and the sand it works on.
 */
export class Cove {
  readonly waves: WaveClock;
  readonly sand: SandField;
  readonly clouds: Clouds;
  private rippleNext = 0;

  constructor(private readonly engine: Engine) {
    const { world, scene, quality } = engine;
    this.waves = new WaveClock({ seed: 7, tempo: engine.reducedMotion ? 1.4 : 1 });
    world.uCalm.value = engine.reducedMotion ? 1 : 0;
    this.sand = new SandField(world, quality);
    scene.add(createTerrain(world, quality));
    scene.add(createDetails(world, quality === 'high' ? 1 : 0.55));
    scene.add(createProps(world, quality === 'high' ? 1 : 0.6));
    this.clouds = createClouds(world);
    scene.add(this.clouds.group);
  }

  /** Set the sea's uniforms for time t, then let it work on the sand for dt. */
  update(dt: number, t: number): void {
    const { world, renderer } = this.engine;
    const w = this.waves.at(t);
    if (w) {
      const tau = this.waves.tau(t);
      world.uWaveFront.value = w.reach * frontProfile(tau);
      world.uWavePhase.value.set(w.phaseA, w.phaseB);
      world.uWaveTau.value = tau;
      world.uWaveReach.value = w.reach;
    } else {
      world.uWaveFront.value = 0;
      world.uWaveTau.value = 0;
    }
    this.clouds.update(t);
    this.sand.evolve(renderer, dt);
  }

  /** A soft ring on the water. */
  ripple(x: number, z: number, strength = 1): void {
    const slot = this.engine.world.uRipples.value[this.rippleNext];
    slot.set(x, z, this.engine.world.uTime.value, strength);
    this.rippleNext = (this.rippleNext + 1) % this.engine.world.uRipples.value.length;
  }

  dispose(): void {
    this.sand.dispose();
  }
}
