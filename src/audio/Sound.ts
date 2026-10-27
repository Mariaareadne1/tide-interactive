import { playSong } from './song';

/**
 * The beach's sound, all made in the browser: the surf (a low roar as a
 * wave runs up, a long hiss as it draws back over the sand), a dry scritch
 * under your fingertip, little sounds when crabs dig in or pop out, and the
 * crabs' song. Nothing plays until the first touch (browsers require it);
 * a toggle mutes everything and is remembered on this device.
 */

const PREF = 'tide-sound';

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) !== 'off';
  } catch {
    return true;
  }
}

export interface SeaState {
  /** Local phase of the current wave, 0..1. */
  tau: number;
  /** How far it reaches at its peak (m). */
  reach: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private surf: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private hiss: GainNode | null = null;
  private scritch: GainNode | null = null;
  private scritchFilter: BiquadFilterNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private stopSong: (() => void) | null = null;
  private songEnds = 0;
  enabled = readPref();
  /** Notes scheduled for the current song (for tests). */
  songPlaying = false;

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Start audio on the first user gesture. Safe to call often. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return; // no audio here: the piece is still whole without it
    }
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.enabled ? 0.8 : 0;
    master.connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    master.connect(this.recordDest);
    this.master = master;

    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    // brown-ish noise for the roar, white for the hiss (separate loops, so they don't beat)
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const white = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;

    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    // the roar of water running up
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'lowpass';
    this.surfFilter.frequency.value = 500;
    this.surf = ctx.createGain();
    this.surf.gain.value = 0.05;
    loop(noise).connect(this.surfFilter).connect(this.surf).connect(master);
    // the hiss of it drawing back through the sand
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 4200;
    hp.Q.value = 0.6;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    loop(white).connect(hp).connect(this.hiss).connect(master);
    // a fingertip in the sand
    this.scritchFilter = ctx.createBiquadFilter();
    this.scritchFilter.type = 'bandpass';
    this.scritchFilter.frequency.value = 2600;
    this.scritchFilter.Q.value = 1.4;
    this.scritch = ctx.createGain();
    this.scritch.gain.value = 0;
    loop(white).connect(this.scritchFilter).connect(this.scritch).connect(master);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(PREF, on ? 'on' : 'off');
    } catch {
      // private mode: the toggle still works for this visit
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.08);
  }

  /** The audio the recorder should include, when there is any. */
  get stream(): MediaStream | null {
    return this.enabled && this.recordDest ? this.recordDest.stream : null;
  }

  /**
   * Once a frame: the surf follows the wave, the scritch follows the finger.
   * `drawSpeed` is how fast the fingertip moves through the sand (m/s); `wet` 0..1.
   */
  update(sea: SeaState, drawSpeed: number, wet: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.surf || !this.hiss || !this.scritch || !this.surfFilter || !this.scritchFilter) return;
    const now = ctx.currentTime;
    const { tau, reach } = sea;
    const size = Math.min(1.4, 0.45 + reach / 4);
    // a wave gathers and breaks (end of the cycle), rushes up, then draws back hissing
    const breaking = tau > 0.8 ? (tau - 0.8) / 0.2 : 0;
    const rush = tau < 0.35 ? Math.sin((tau / 0.35) * Math.PI * 0.5 + Math.PI * 0.5) : 0;
    const draining = tau > 0.38 && tau < 0.92 ? Math.sin(((tau - 0.38) / 0.54) * Math.PI) : 0;
    const duck = this.songPlaying ? 0.45 : 1;
    this.surf.gain.setTargetAtTime((0.05 + 0.2 * Math.max(breaking * breaking, rush) * size) * duck, now, 0.12);
    this.surfFilter.frequency.setTargetAtTime(380 + 700 * Math.max(breaking, rush), now, 0.15);
    this.hiss.gain.setTargetAtTime(0.035 * draining * size * duck, now, 0.2);
    // dry sand scratches higher and brighter; wet sand is a softer, lower swish
    const s = Math.min(1, drawSpeed / 1.6);
    this.scritch.gain.setTargetAtTime(0.22 * s, now, s > 0 ? 0.02 : 0.06);
    this.scritchFilter.frequency.setTargetAtTime(1500 + 2200 * (1 - wet), now, 0.05);
    if (this.songPlaying && now > this.songEnds) this.songPlaying = false;
  }

  /** A crab pops out of the sand: a soft little bloop. */
  pop(): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(980, t + 0.09);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A crab digs in: three quick scratches. */
  dig(): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || !this.scritchFilter) return;
    for (let k = 0; k < 3; k++) {
      const t = ctx.currentTime + k * 0.09;
      const src = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + k * 300;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      src.connect(bp).connect(g).connect(master);
      src.start(t);
    }
  }

  /** Start the crabs' song `delay` seconds from now. */
  song(delay: number, seconds: number): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    this.stopSong?.();
    const when = ctx.currentTime + Math.max(0, delay);
    this.stopSong = playSong(ctx, master, when);
    this.songPlaying = true;
    this.songEnds = when + seconds;
  }

  stopTheSong(): void {
    this.stopSong?.();
    this.stopSong = null;
    this.songPlaying = false;
  }

  dispose(): void {
    this.stopSong?.();
    void this.ctx?.close();
    this.ctx = null;
  }
}
