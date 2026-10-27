import { useEffect, useRef, useState } from 'react';
import { Engine } from '../engine/Engine';
import { Store, useAppState } from '../state/store';
import { TideApp } from './TideApp';
import { PointerInput } from '../interaction/PointerInput';
import { recordCanvas } from '../capture/recorder';
import { Chrome } from './ui/Chrome';
import { SelectionOverlay } from './ui/SelectionOverlay';

interface Running {
  engine: Engine;
  app: TideApp;
  input: PointerInput;
}

declare global {
  interface Window {
    __tide?: Running & { store: Store; record: typeof recordCanvas };
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => new Store());
  const [running, setRunning] = useState<Running | null>(null);
  const fatal = useAppState(store, (s) => s.fatal);
  const uiHidden = useAppState(store, (s) => s.uiHidden);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const params = new URLSearchParams(location.search);
    let engine: Engine;
    try {
      engine = new Engine({ canvas, quality: params.get('quality') === 'low' ? 'low' : 'high' });
    } catch (error) {
      store.set({ fatal: `TIDE needs WebGL 2, which this browser could not start. (${error instanceof Error ? error.message : String(error)})` });
      return;
    }
    const app = new TideApp(engine, store);
    const input = new PointerInput(stage, app);
    const resize = () => engine.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    app.start();
    engine.start();

    const lost = (e: Event) => {
      e.preventDefault();
      engine.stop();
      store.toast('The graphics context was lost. Restoring…');
    };
    // the heightmap lived on the GPU: the beach comes back smooth
    const restored = () => {
      app.resetSand();
      engine.start();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const visibility = () => (document.hidden ? engine.stop() : engine.start());
    document.addEventListener('visibilitychange', visibility);

    const r: Running = { engine, app, input };
    window.__tide = { ...r, store, record: recordCanvas };
    setRunning(r);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      ro.disconnect();
      input.dispose();
      app.dispose();
      engine.dispose();
      delete window.__tide;
    };
  }, [store]);

  const capture = async () => {
    if (!running) return;
    try {
      const { engine } = running;
      const dpr = engine.renderer.getPixelRatio();
      const scale = Math.max(1, Math.min(2.5, 3840 / (engine.canvas.clientWidth * dpr)));
      downloadBlob(await engine.capturePNG(scale), `tide-${stamp()}.png`);
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Could not save the image.');
    }
  };

  const record = async () => {
    if (!running || store.get().recording) return;
    store.set({ recording: true, uiHidden: true, selection: null });
    try {
      const rec = await recordCanvas(running.engine.canvas, { seconds: 12 });
      downloadBlob(rec.blob, `tide-${stamp()}.${rec.extension}`);
      store.toast(`Saved a ${(rec.durationMs / 1000).toFixed(0)}-second ${rec.extension.toUpperCase()} clip.`);
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Recording failed.');
    } finally {
      store.set({ recording: false, uiHidden: false });
    }
  };

  useEffect(() => {
    if (!running) return;
    const { app, input } = running;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        app.undo();
        return;
      }
      if (mod) return;
      const sel = store.get().selection;
      switch (key) {
        case 'escape':
          if (input.isDrawing) input.abort();
          else if (store.get().uiHidden) store.set({ uiHidden: false });
          else store.set({ selection: null });
          break;
        case 'h': if (!store.get().recording) store.set({ uiHidden: !store.get().uiHidden }); break;
        case 'f': if (sel) app.followLine(sel.id); break;
        case 'w': if (sel) app.waveClaws(sel.id); break;
        case 'b': if (sel) app.toggleBurrow(sel.id); break;
        case 'tab': {
          const ids = app.beach.crabs.map((c) => c.id);
          e.preventDefault();
          const i = sel ? ids.indexOf(sel.id) : -1;
          store.set({ selection: { kind: 'crab', id: ids[(i + (e.shiftKey ? ids.length - 1 : 1) + ids.length) % ids.length] } });
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, store]);

  return (
    <div className={`stage${uiHidden ? ' ui-hidden' : ''}`} ref={stageRef}>
      <canvas ref={canvasRef} aria-label="A small painted cove. Draw in the sand with your finger; crabs come to walk along your line, and the waves wash it away." role="img" />
      {running && (
        <div className="chrome">
          <SelectionOverlay app={running.app} />
          <Chrome app={running.app} onCapture={capture} onRecord={record} />
        </div>
      )}
      {fatal && (
        <div className="fatal" role="alert">
          <h2>The beach could not open</h2>
          <p>{fatal}</p>
        </div>
      )}
    </div>
  );
}
