import { useEffect, useState } from 'react';
import type { TideApp } from '../TideApp';
import { useAppState } from '../../state/store';
import { Icon } from './icons';

interface ChromeProps {
  app: TideApp;
  onCapture: () => void;
  onRecord: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Undo the last line', '⌘Z'],
  ['Select a crab', 'Tab'],
  ['Follow · Wave · Burrow', 'F · W · B'],
  ['Deselect / cancel', 'Esc'],
  ['Hide interface', 'H'],
];

export function Chrome({ app, onCapture, onRecord }: ChromeProps) {
  const { store } = app;
  const undoable = useAppState(store, (s) => s.undoable);
  const hasDrawn = useAppState(store, (s) => s.hasDrawn);
  const toast = useAppState(store, (s) => s.toast);
  const recording = useAppState(store, (s) => s.recording);
  const selection = useAppState(store, (s) => s.selection);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const hint = hasDrawn || selection !== null ? null : 'Draw in the wet sand.';

  const runMenu = (action: 'record' | 'hide') => {
    setPanel('none');
    if (action === 'hide') store.set({ uiHidden: true });
    if (action === 'record') onRecord();
  };

  return (
    <>
      <header className="wordmark">
        <h1>TIDE</h1>
        <p>draw in the sand</p>
      </header>

      <div className="top-actions">
        <button className="icon-btn ghost" aria-label="Help" aria-expanded={panel === 'help'} title="Help" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          <Icon name="help" />
        </button>
        <button className="icon-btn ghost" aria-label="More" aria-expanded={panel === 'menu'} title="More" onClick={() => setPanel(panel === 'menu' ? 'none' : 'menu')}>
          <Icon name="menu" />
        </button>
      </div>

      {panel === 'help' && (
        <section className="panel help" aria-label="How it works">
          <p className="lede">Draw in the sand with your finger — a word, a heart, a spiral. The crabs come and walk along it. Then the waves come in and gently wash it away.</p>
          <p className="aside">Nothing is kept. Lines low on the beach soften over two or three waves; high up, they last until a big one comes. Reload, and the sand is smooth again.</p>
          <dl>
            {SHORTCUTS.map(([what, key]) => (
              <div key={what}><dt>{what}</dt><dd>{key}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {panel === 'menu' && (
        <section className="panel menu" aria-label="More">
          <button onClick={() => runMenu('record')} disabled={recording}>Record 12-second clip</button>
          <button onClick={() => runMenu('hide')}>Hide interface <kbd>H</kbd></button>
        </section>
      )}

      {hint && <p className="hint" aria-live="polite">{hint}</p>}

      <nav className="toolbar" aria-label="Tools">
        <button className="icon-btn" aria-label="Undo" title="Undo the last line (⌘Z)" disabled={undoable === 0} onClick={() => app.undo()}><Icon name="undo" /></button>
        <span className="sep" />
        <button className="icon-btn" aria-label="Save image" title="Save image" onClick={onCapture}><Icon name="camera" /></button>
      </nav>

      {recording && <p className="rec" aria-live="polite"><i />Recording</p>}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </>
  );
}

function Toast({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3200);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return <p className="toast" role="status">{text}</p>;
}
