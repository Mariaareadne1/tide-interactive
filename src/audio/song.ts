import { BEAT, INTRO_BEATS } from '../crabs/dance';

/**
 * The crabs' song: a little calypso, made here from oscillators and noise —
 * steel pan melody, a marimba bass, off-beat chord stabs, a shaker and a soft
 * drum. Every note is placed by beat number, from the same BPM the dance
 * uses, so the claws land on the music.
 */

type Note = [beat: number, midi: number, beats: number];

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// C | F | G | C | Am | F | G | C — one bar each, after a bar of counting in
const CHORDS: number[][] = [
  [60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67],
  [69, 72, 76], [65, 69, 72], [67, 71, 74], [60, 64, 67],
];
const ROOTS = [48, 53, 55, 48, 57, 53, 55, 48];

const MELODY: Note[][] = [
  [[0, 76, 0.5], [0.5, 79, 0.5], [1, 84, 1], [2, 79, 0.5], [2.5, 76, 0.5], [3, 79, 1]],
  [[0, 81, 0.5], [0.5, 84, 0.5], [1, 81, 0.5], [1.5, 77, 0.5], [2, 81, 1], [3, 79, 1]],
  [[0, 71, 0.5], [0.5, 74, 0.5], [1, 79, 1], [2, 77, 0.5], [2.5, 76, 0.5], [3, 74, 1]],
  [[0, 76, 0.5], [0.5, 72, 0.5], [1, 76, 0.5], [1.5, 79, 0.5], [2, 84, 2]],
  [[0, 81, 0.5], [0.5, 84, 0.5], [1, 88, 1], [2, 86, 0.5], [2.5, 84, 0.5], [3, 81, 1]],
  [[0, 77, 0.5], [0.5, 81, 0.5], [1, 84, 0.5], [1.5, 81, 0.5], [2, 77, 0.5], [2.5, 79, 0.5], [3, 81, 1]],
  [[0, 79, 1], [1, 83, 0.5], [1.5, 86, 0.5], [2, 83, 0.5], [2.5, 79, 0.5], [3, 77, 1]],
  [[0, 76, 0.5], [0.5, 79, 0.5], [1, 76, 0.5], [1.5, 79, 0.5], [2, 84, 4]],
];

/** Every note of the song: [beat from the start, midi, length in beats]. Exported for tests. */
export function melodyNotes(): Note[] {
  const out: Note[] = [[2, 67, 0.5], [2.5, 69, 0.5], [3, 71, 1]]; // a pickup into the first bar
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
  bus.gain.value = 0.8;
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

  // steel pan: a bright fundamental with its octave and a slightly sour twelfth, a little pitch drop on the strike
  const pan = (midi: number, beat: number, beats: number, vel = 1) => {
    const f = midiHz(midi), t = at(beat), dur = Math.min(1.4, 0.35 + beats * BEAT * 0.9);
    tone('sine', f, t, dur, 0.16 * vel, 0.012);
    tone('sine', f * 2, t, dur * 0.7, 0.07 * vel);
    tone('sine', f * 3.02, t, dur * 0.35, 0.025 * vel);
  };
  // marimba bass
  const bass = (midi: number, beat: number) => {
    const f = midiHz(midi), t = at(beat);
    tone('sine', f, t, 0.45, 0.22);
    tone('sine', f * 4, t, 0.08, 0.05);
  };
  const stab = (chord: number[], beat: number) => chord.forEach((m) => tone('triangle', midiHz(m), at(beat), 0.14, 0.035));
  const shaker = (beat: number, vel: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    const t = at(beat);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp).connect(g).connect(bus);
    src.start(t, (beat * 0.37) % 0.8, 0.1);
    sources.push(src);
  };
  const drum = (beat: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = at(beat);
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.3);
    sources.push(o);
  };

  // a bar of counting in: shaker and drum
  for (let e = 0; e < INTRO_BEATS * 2; e++) shaker(e / 2, e % 2 ? 1 : 0.5);
  drum(0);
  drum(2);
  for (const [b, m, d] of melodyNotes()) pan(m, b, d);
  CHORDS.forEach((chord, i) => {
    const b0 = INTRO_BEATS + i * 4;
    const last = i === CHORDS.length - 1;
    // calypso bass: root, fifth on the and of two, root, fifth
    bass(ROOTS[i], b0);
    if (!last) {
      bass(ROOTS[i] + 7, b0 + 1.5);
      bass(ROOTS[i], b0 + 2);
      bass(ROOTS[i] + 7, b0 + 3);
      for (const off of [0.5, 1.5, 2.5, 3.5]) stab(chord, b0 + off);
    } else {
      // the finish: a ringing chord as they throw their claws up
      bass(ROOTS[i] - 12, b0 + 2);
      chord.forEach((m) => pan(m + 12, b0 + 2, 3, 0.7));
    }
    for (let e = 0; e < 8; e++) if (!last || e < 5) shaker(b0 + e / 2, e % 2 ? 1 : 0.55);
    drum(b0);
    drum(b0 + 2);
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
