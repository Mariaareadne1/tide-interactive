import { describe, expect, test } from 'vitest';
import { footfalls, footWorld, LEGS } from '../../src/crabs/anatomy';
import { BEAT, DANCE_BEATS, INTRO_BEATS, RIPPLE_BAR, discoLevel, ROW_U, SONG_BEATS, SONG_SECONDS, danceFrame, danceSlots } from '../../src/crabs/dance';
import { isFinitePose } from '../../src/crabs/pose';
import { CrabController, type CrabWorld } from '../../src/crabs/CrabController';
import { melodyNotes } from '../../src/audio/song';
import { loopShape, resample } from '../../src/sand/lines';
import { pickRecordingType } from '../../src/capture/recorder';
import { WaveClock } from '../../src/sea/waves';
import { isWalkable, upBeach } from '../../src/scene/beach';

describe('footprints', () => {
  test('every foot comes down exactly once per cycle', () => {
    const counts = new Array(LEGS.length).fill(0);
    let ph = 0.123;
    for (let i = 0; i < 100; i++) {
      const next = ph + (Math.PI * 2) / 100;
      for (const leg of footfalls(ph, next)) counts[leg]++;
      ph = next;
    }
    expect(counts).toEqual(new Array(LEGS.length).fill(1));
    expect(footfalls(1, 1)).toEqual([]);
  });

  test('feet land around the crab, on its sides, turning with it', () => {
    for (const heading of [0, 1, -2.5]) {
      for (let i = 0; i < LEGS.length; i++) {
        const f = footWorld(2, -1, heading, 1, i);
        const r = Math.hypot(f.x - 2, f.z + 1);
        expect(r).toBeGreaterThan(0.25);
        expect(r).toBeLessThan(0.6);
      }
      // left and right feet are on opposite sides
      const a = footWorld(0, 0, heading, 1, 0), b = footWorld(0, 0, heading, 1, 4);
      expect(a.x * b.x + a.z * b.z).toBeLessThan(0);
    }
    expect(Math.hypot(footWorld(0, 0, 0, 1.5, 0).x, footWorld(0, 0, 0, 1.5, 0).z)).toBeGreaterThan(Math.hypot(footWorld(0, 0, 0, 1, 0).x, footWorld(0, 0, 0, 1, 0).z));
  });
});

describe('a shell drawn in the sand', () => {
  const ring = (r: number, gap = 0) => {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * (Math.PI * 2 - gap);
      pts.push({ x: 1 + Math.cos(a) * r, z: -1 + Math.sin(a) * r * 0.8 });
    }
    return resample(pts, 0.02);
  };
  test('a loop is closed, with its centre and size', () => {
    const s = loopShape(ring(0.4));
    expect(s.closed).toBe(true);
    expect(s.cx).toBeCloseTo(1, 1);
    expect(s.cz).toBeCloseTo(-1, 1);
    expect(s.radius).toBeGreaterThan(0.3);
    expect(s.radius).toBeLessThan(0.42);
  });
  test('a line, a U, or a tiny scribble is not', () => {
    expect(loopShape(resample([{ x: 0, z: 0 }, { x: 1.2, z: 0.3 }], 0.02)).closed).toBe(false);
    expect(loopShape(ring(0.4, Math.PI * 0.9)).closed).toBe(false);
    expect(loopShape(ring(0.05)).closed).toBe(false);
  });
});

describe('the dance', () => {
  test('there is a place in the row for every crab, on open sand above ordinary waves', () => {
    for (const n of [1, 4, 7, 10]) {
      const slots = danceSlots(n);
      expect(slots).toHaveLength(n);
      for (const s of slots) {
        expect(isWalkable(s.x, s.z)).toBe(true);
        expect(upBeach(s.x, s.z)).toBeCloseTo(ROW_U, 3);
        // ordinary waves reach at most 2.3 m (×1.16 at the wobble's peak)
        expect(upBeach(s.x, s.z)).toBeGreaterThan(2.3 * 1.16 + 0.3);
      }
      for (let i = 1; i < n; i++) expect(slots[i].x - slots[i - 1].x).toBeGreaterThan(0.6);
    }
  });

  test('every crab’s dance is finite for the whole song, and they move together', () => {
    for (let b = 0; b < SONG_BEATS; b += 0.05) {
      for (let slot = 0; slot < 6; slot++) {
        const f = danceFrame(b, slot, 6);
        expect(isFinitePose(f.pose) && Number.isFinite(f.along) && Number.isFinite(f.hop) && Number.isFinite(f.spin)).toBe(true);
        expect(Math.abs(f.along)).toBeLessThan(0.25);
      }
      // apart from the ripple bar, everyone is in step
      const bar = Math.floor((b - INTRO_BEATS) / 4);
      if (bar !== RIPPLE_BAR) expect(danceFrame(b, 0, 6).pose.clawL).toBeCloseTo(danceFrame(b, 5, 6).pose.clawL, 9);
    }
    // the side-step goes one way, then the other
    expect(danceFrame(INTRO_BEATS + 1, 0, 4).along).toBeGreaterThan(0.1);
    expect(danceFrame(INTRO_BEATS + 3, 0, 4).along).toBeLessThan(-0.1);
    // ta-da: claws high at the end
    expect(danceFrame(INTRO_BEATS + DANCE_BEATS - 0.5, 0, 4).pose.clawL).toBeGreaterThan(1);
  });

  test('sunglasses go on in the count-in and off at the end; the disco lights follow the music', () => {
    expect(danceFrame(0, 0, 4).pose.shades).toBe(0);
    expect(danceFrame(INTRO_BEATS, 0, 4).pose.shades).toBe(1);
    expect(danceFrame(INTRO_BEATS + DANCE_BEATS - 0.5, 2, 4).pose.shades).toBe(1);
    expect(danceFrame(SONG_BEATS - 0.1, 0, 4).pose.shades).toBeLessThan(0.05);
    expect(discoLevel(-1)).toBe(0);
    expect(discoLevel(1)).toBe(1);
    expect(discoLevel(SONG_BEATS - 2)).toBe(1);
    expect(discoLevel(SONG_BEATS + 1)).toBe(0);
  });

  test('the ripple travels down the line', () => {
    const peak = (slot: number) => {
      let best = 0, at = 0;
      for (let b = INTRO_BEATS + RIPPLE_BAR * 4; b < INTRO_BEATS + RIPPLE_BAR * 4 + 4; b += 0.01) {
        const h = danceFrame(b, slot, 5).hop;
        if (h > best) { best = h; at = b; }
      }
      return at;
    };
    expect(peak(0)).toBeLessThan(peak(2));
    expect(peak(2)).toBeLessThan(peak(4));
  });

  test('the song’s notes sit on the beat grid, inside the song, and end on the ta-da', () => {
    const notes = melodyNotes();
    for (const [b, m, d] of notes) {
      expect(b * 2).toBeCloseTo(Math.round(b * 2), 9);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b + Math.min(d, 2)).toBeLessThanOrEqual(SONG_BEATS);
      expect(m).toBeGreaterThan(55);
      expect(m).toBeLessThan(96);
    }
    const last = notes[notes.length - 1];
    expect(last[0]).toBe(INTRO_BEATS + DANCE_BEATS - 2);
    expect(BEAT).toBeCloseTo(60 / 132, 9);
    // short enough for a demo
    expect(SONG_SECONDS).toBeLessThan(12);
  });

  test('crabs gather into the row and dance in place; a wave mid-dance sends them under and back', () => {
    const waves = new WaveClock({ seed: 7 });
    const world = (crabs: CrabController[]): CrabWorld => ({ waves, line: () => undefined, others: (id) => crabs.filter((c) => c.spec.id !== id).map((c) => ({ x: c.x, z: c.z })) });
    const crabs = [1, 2, 3, 4].map((i) => new CrabController({ id: i, seed: i, home: { x: -4 + i * 1.6, z: 0.4 + (i % 2) * 0.6 }, burrowiness: 0.5 }));
    const w = world(crabs);
    const start = 6;
    const slots = danceSlots(4);
    // a big wave arrives in the middle of the song
    waves.scheduleBig(0, start + 8);
    crabs.forEach((c, i) => c.dance(0, slots[i], i, 4, start));
    let hid = 0, danced = 0, offRow = 0;
    for (let t = 0; t < start + SONG_BEATS * BEAT + 2; t += 1 / 60) {
      for (const c of crabs) {
        c.update(1 / 60, t, w);
        if (c.mode === 'hide') hid++;
        if (c.dancing) {
          danced++;
          const i = crabs.indexOf(c);
          if (Math.hypot(c.x - slots[i].x, c.z - slots[i].z) > 0.3) offRow++;
        }
      }
    }
    // most of the song, even with a wave sending them under for a while
    expect(danced).toBeGreaterThan(4 * 60 * SONG_SECONDS * 0.55);
    expect(offRow).toBe(0);
    // the big wave reached the row only if it ran that high; either way, they finish
    if (waves.nextBigAfter(0).reach * 1.1 > ROW_U) expect(hid).toBeGreaterThan(0);
    for (const c of crabs) expect(c.mode).not.toBe('dance');
  });
});

describe('a crab hatched from a drawing', () => {
  test('comes up out of the sand and potters about', () => {
    const waves = new WaveClock({ seed: 1 });
    waves.offset = -1e6;
    const c = new CrabController({ id: 9, seed: 9, home: { x: 0, z: -1 }, burrowiness: 0, size: 1.3 });
    c.hatch(0);
    expect(c.pose.burrow).toBeGreaterThan(0.9);
    const w: CrabWorld = { waves, line: () => undefined, others: () => [] };
    const modes = new Set<string>();
    for (let t = 0; t < 4; t += 1 / 60) {
      c.update(1 / 60, t, w);
      modes.add(c.mode);
    }
    expect(modes.has('emerge')).toBe(true);
    expect(c.pose.burrow).toBeLessThan(0.05);
  });
});

describe('recording with sound', () => {
  test('picks a container that can carry audio when there is some', () => {
    const chrome = (t: string) => ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus'].includes(t);
    expect(pickRecordingType(chrome, true)).toBe('video/mp4;codecs=avc1.640028,mp4a.40.2');
    expect(pickRecordingType(chrome, false)).toBe('video/mp4;codecs=avc1.640028');
    expect(pickRecordingType((t) => t === 'video/webm', true)).toBe('video/webm');
  });
});
