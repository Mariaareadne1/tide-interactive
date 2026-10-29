import { BEAT, INTRO_BEATS } from '../crabs/dance';

/**
 * The crabs' song: Beethoven's Fifth as a disco track — the most famous four
 * notes there are (1808, public domain) over four-on-the-floor. Made here
 * from oscillators and noise: a brassy lead and string pad, octave-bouncing
 * bass, kick, claps and open hi-hats, a riser to count in and a crash on the
 * ta-da. Every note is placed by beat number, from the same BPM the dance
 * uses, so the claws land on the music.
 */

type Note = [beat: number, midi: number, beats: number];

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** "da-da-da-DUMMM" on these pitches, landing on beat 3 of the bar. */
const motto = (short: number, long: number): Note[] => [[0.5, short, 0.5], [1, short, 0.5], [1.5, short, 0.5], [2, long, 2]];

/** The tune, one dance bar per row, in beats from that bar. */
const MELODY: Note[][] = [
  motto(79, 75), // G G G E♭
  motto(77, 74), // F F F D
  motto(80, 79), // A♭ A♭ A♭ G
  motto(87, 84), // E♭ E♭ E♭ C, up high
  [[0, 79, 0.5], [0.5, 79, 0.5], [1, 79, 0.5], [2, 84, 2]], // G G G … C — ta-da, in C major
];

// one chord per bar, C minor until the bright last bar: [bass root, chord]
const HARMONY: [number, number[]][] = [
  [36, [60, 63, 67]],
  [43, [59, 62, 65, 67]],
  [41, [60, 65, 68]],
  [36, [60, 63, 67]],
  [36, [60, 64, 67]],
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
  bus.gain.value = 0.85;
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
  // a soft string pad: detuned saws, slow attack, dark filter
  const pad = (chord: number[], beat: number, beats: number, vel = 1) => {
    const t = at(beat), dur = beats * BEAT;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.018 * vel, t + 0.15);
    g.gain.setValueAtTime(0.018 * vel, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g).connect(bus);
    for (const m of chord) {
      for (const detune of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
        sources.push(o);
      }
    }
  };
  const bass = (midi: number, beat: number, len = 0.22, vel = 1) => {
    const f = midiHz(midi), t = at(beat);
    tone('sawtooth', f, t, len, 0.07 * vel);
    tone('sine', f, t, len, 0.2 * vel);
  };
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
  const clap = (beat: number) => {
    // three quick bursts smeared together
    for (const d of [0, 0.012, 0.024]) hiss(beat + d / BEAT, 0.07, 1200, 0.1);
  };
  const openHat = (beat: number) => hiss(beat, 0.05, 7500, 0.16);
  const closedHat = (beat: number) => hiss(beat, 0.025, 9000, 0.03);
  const crash = (beat: number) => hiss(beat, 0.16, 4500, 1.6);
  const kick = (beat: number, vel = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = at(beat);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.34 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.3);
    sources.push(o);
  };
  // a filtered-noise whoosh rising into the downbeat
  const riser = (beat: number, beats: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    const g = ctx.createGain();
    const t = at(beat), dur = beats * BEAT;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    src.connect(bp).connect(g).connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
    sources.push(src);
  };

  // counting in: the beat starts — kick, hats — under a rising whoosh
  for (let b = 0; b < INTRO_BEATS; b++) {
    kick(b, 0.8);
    openHat(b + 0.5);
  }
  riser(0, INTRO_BEATS);

  for (const [b, m, d] of melodyNotes()) {
    lead(m, b, d);
    lead(m - 12, b, d, 0.45);
  }
  HARMONY.forEach(([root, chord], i) => {
    const b0 = INTRO_BEATS + i * 4;
    if (i === HARMONY.length - 1) {
      // the last bar: the beat carries on to the ta-da, then a big C major and a crash
      for (let b = 0; b < 2; b++) {
        kick(b0 + b);
        openHat(b0 + b + 0.5);
        bass(root + (b ? 12 : 0), b0 + b);
      }
      kick(b0 + 2, 1.1);
      bass(root, b0 + 2, 1.2, 1.2);
      chord.forEach((m) => lead(m + 12, b0 + 2, 2.2, 0.35));
      pad(chord, b0 + 2, 2);
      crash(b0 + 2);
      return;
    }
    pad(chord, b0, 4);
    for (let b = 0; b < 4; b++) {
      kick(b0 + b);
      if (b % 2) clap(b0 + b);
      openHat(b0 + b + 0.5);
      closedHat(b0 + b + 0.25);
      closedHat(b0 + b + 0.75);
    }
    // disco octaves: low, high, low, high on the eighths
    for (let e = 0; e < 8; e++) bass(root + (e % 2 ? 12 : 0), b0 + e / 2);
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
