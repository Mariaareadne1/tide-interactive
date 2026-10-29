import { BEAT, INTRO_BEATS } from '../crabs/dance';

/**
 * The crabs' song: the Can-Can — Offenbach's "Galop infernal" (1858, public
 * domain) — made here from oscillators and noise: a brassy lead, a bright
 * glockenspiel doubling, oom-pah bass and chords, a snare roll to count in,
 * and a crash on the ta-da. Every note is placed by beat number, from the
 * same BPM the dance uses, so the claws land on the music.
 */

type Note = [beat: number, midi: number, beats: number];

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const C = 72, D = 74, E = 76, F = 77, G = 79, A = 81, B = 83, C6 = 84;

/** The tune, one dance bar (two bars of 2/4) per row, in beats from that bar. */
const MELODY: Note[][] = [
  [[0, C, 2], [2, D, 0.5], [2.5, F, 0.5], [3, E, 0.5], [3.5, D, 0.5]],
  [[0, G, 1], [1, G, 1], [2, G, 0.5], [2.5, A, 0.5], [3, E, 0.5], [3.5, F, 0.5]],
  [[0, D, 1], [1, D, 1], [2, D, 0.5], [2.5, F, 0.5], [3, E, 0.5], [3.5, D, 0.5]],
  [[0, C, 0.5], [0.5, C6, 0.5], [1, B, 0.5], [1.5, A, 0.5], [2, G, 0.5], [2.5, F, 0.5], [3, E, 0.5], [3.5, D, 0.5]],
  [[0, E, 0.5], [0.5, D, 0.5], [1, C, 1], [2, C6, 2]],
];

// oom-pah under each half bar: [bass root, chord]
const C_MAJ = [60, 64, 67], G7 = [59, 65, 67];
const HARMONY: [number, number[]][][] = [
  [[48, C_MAJ], [48, C_MAJ]],
  [[48, C_MAJ], [48, C_MAJ]],
  [[43, G7], [43, G7]],
  [[48, C_MAJ], [43, G7]],
  [[48, C_MAJ], [36, C_MAJ]],
];

/** Every note of the tune: [beat from the start, midi, length in beats]. Exported for tests. */
export function melodyNotes(): Note[] {
  const out: Note[] = [];
  MELODY.forEach((bar, i) => bar.forEach(([b, m, d]) => out.push([INTRO_BEATS + i * 4 + b, m, d])));
  return out;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 16807) % 2147483647;
    d[i] = (seed / 2147483647) * 2 - 1;
  }
  return buf;
}

/** Schedule the whole song to start at `when` (audio-clock seconds). Returns a function that stops it. */
export function playSong(ctx: AudioContext, out: AudioNode, when: number): () => void {
  const bus = ctx.createGain();
  bus.gain.value = 0.7;
  bus.connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const at = (beat: number) => when + beat * BEAT;
  const noise = noiseBuffer(ctx);

  const tone = (type: OscillatorType, freq: number, t: number, dur: number, gain: number, bend = 0) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * (1 + bend), t);
    if (bend) o.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
    sources.push(o);
  };

  // a brassy lead: two detuned saws through a lowpass that opens on the attack
  const lead = (midi: number, beat: number, beats: number, vel = 1) => {
    const f = midiHz(midi), t = at(beat), dur = Math.max(0.12, beats * BEAT * 0.92);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(f * 6, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(f * 2.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.075 * vel, t + 0.012);
    g.gain.setValueAtTime(0.06 * vel, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    lp.connect(g).connect(bus);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
      sources.push(o);
    }
  };
  // glockenspiel an octave up, for sparkle
  const glock = (midi: number, beat: number, vel = 1) => {
    const f = midiHz(midi + 12), t = at(beat);
    tone('sine', f, t, 0.5, 0.05 * vel);
    tone('sine', f * 2.76, t, 0.12, 0.012 * vel);
  };
  const bass = (midi: number, beat: number, len = 0.35) => {
    const f = midiHz(midi), t = at(beat);
    tone('triangle', f, t, len, 0.2);
    tone('sine', f * 2, t, 0.08, 0.06);
  };
  const stab = (chord: number[], beat: number, gain = 0.04) => chord.forEach((m) => tone('triangle', midiHz(m), at(beat), 0.12, gain));
  const hiss = (beat: number, vel: number, cutoff: number, len: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = cutoff;
    const g = ctx.createGain();
    const t = at(beat);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(hp).connect(g).connect(bus);
    src.start(t, (beat * 0.37) % 0.8, len + 0.05);
    sources.push(src);
  };
  const snare = (beat: number, vel: number) => hiss(beat, 0.11 * vel, 1800, 0.09);
  const crash = (beat: number) => hiss(beat, 0.16, 4500, 1.6);
  const drum = (beat: number, vel = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = at(beat);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    g.gain.setValueAtTime(0.3 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.3);
    sources.push(o);
  };

  // counting in: a snare roll that swells, and two big hits — "and… GO"
  for (let k = 0; k < 24; k++) snare(k / 8, 0.25 + 0.75 * (k / 24));
  drum(3);
  stab(G7, 3, 0.05);
  drum(3.5);
  stab(G7, 3.5, 0.05);

  for (const [b, m, d] of melodyNotes()) {
    lead(m, b, d);
    glock(m, b, d >= 2 ? 1.2 : 0.8);
  }
  HARMONY.forEach((halves, i) => {
    const b0 = INTRO_BEATS + i * 4;
    const last = i === HARMONY.length - 1;
    halves.forEach(([root, chord], h) => {
      const hb = b0 + h * 2;
      if (last && h === 1) {
        // the ta-da: a big ringing chord, a low C and a crash
        bass(root, hb, 1.2);
        chord.forEach((m) => lead(m + 12, hb, 2.2, 0.35));
        crash(hb);
        drum(hb, 1);
        return;
      }
      // oom-pah: bass on the beat, chord on the off-beat
      bass(root, hb);
      stab(chord, hb + 0.5);
      bass(root + 7, hb + 1);
      stab(chord, hb + 1.5);
      drum(hb, 0.8);
      snare(hb + 1, 0.8);
      for (let e = 0; e < 4; e++) hiss(hb + e / 2, 0.035, 7000, 0.04);
    });
  });

  return () => {
    const now = ctx.currentTime;
    bus.gain.setTargetAtTime(0, now, 0.05);
    for (const s of sources) {
      try {
        s.stop(now + 0.3);
      } catch {
        // already finished
      }
    }
  };
}
