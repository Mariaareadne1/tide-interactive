/**
 * Records what the visitor sees: the WebGL canvas, but none of the
 * interface chrome. Lines live in the sand itself (the heightmap), not in an
 * overlay, so the groove, the waves and the crabs are all in the frame.
 * The container is negotiated — MP4/H.264 where the browser can encode it,
 * else WebM.
 */

const CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];
const WITH_AUDIO = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
];

export function pickRecordingType(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t), withAudio = false): string | null {
  return (withAudio ? WITH_AUDIO.find((t) => isSupported(t)) : null) ?? CANDIDATES.find((t) => isSupported(t)) ?? null;
}

export interface Recording {
  blob: Blob;
  type: string;
  extension: 'mp4' | 'webm';
  durationMs: number;
}

export interface RecordOptions {
  seconds: number;
  fps?: number;
  /** Sound to record alongside (the surf, the crabs' song). */
  audio?: MediaStream | null;
  /** Resolves early when it settles (for scripted demos). */
  until?: Promise<unknown>;
}

export async function recordCanvas(canvas: HTMLCanvasElement, options: RecordOptions): Promise<Recording> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  const audioTracks = options.audio?.getAudioTracks() ?? [];
  const type = pickRecordingType(undefined, audioTracks.length > 0);
  if (!type) throw new Error('No supported video format for recording.');
  const fps = options.fps ?? 60;

  // composite into a 2D canvas each frame, just after the scene has drawn
  const out = document.createElement('canvas');
  out.width = canvas.width - (canvas.width % 2);
  out.height = canvas.height - (canvas.height % 2);
  const ctx = out.getContext('2d');
  if (!ctx || typeof out.captureStream !== 'function') throw new Error('This browser cannot record the canvas.');
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
  };
  // queue behind the engine's own frame callback so the drawing buffer is fresh
  requestAnimationFrame(() => (raf = requestAnimationFrame(frame)));

  const stream = out.captureStream(fps);
  // only when the container can carry it: otherwise the clip is silent rather than failing
  if (WITH_AUDIO.includes(type)) for (const track of audioTracks) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 18_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });
  const started = performance.now();
  recorder.start(250);
  await Promise.race([new Promise((r) => setTimeout(r, options.seconds * 1000)), options.until ?? new Promise(() => {})]);
  recorder.stop();
  await stopped;
  cancelAnimationFrame(raf);
  stream.getVideoTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: type.split(';')[0] });
  if (blob.size === 0) throw new Error('The recording came out empty.');
  return { blob, type, extension: type.startsWith('video/mp4') ? 'mp4' : 'webm', durationMs: performance.now() - started };
}
