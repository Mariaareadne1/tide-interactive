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
  ['Everyone dance', 'D'],
  ['Add a crab (draw a loop, or tap)', 'C'],
  ['Sound on / off', 'M'],
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
  const addingCrab = useAppState(store, (s) => s.addingCrab);
  const crabCount = useAppState(store, (s) => s.crabCount);
  const soundOn = useAppState(store, (s) => s.soundOn);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const hint = addingCrab ? 'Draw a shell — a loop — or tap the sand, and a crab digs out. Esc when you’re done.' : hasDrawn || selection !== null ? null : 'Draw in the wet sand.';

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
          <p className="aside">Tap <b>Add a crab</b>, then draw a shell — a loop — or just tap the sand, and a crab digs its way up out of it. Select any crab and press <b>Dance</b>: they all line up along the shore and dance to a song.</p>
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
        <button className={addingCrab ? 'tool on' : 'tool'} aria-pressed={addingCrab} title="Add a crab: draw a loop or tap the sand (C)" disabled={crabCount >= 10 && !addingCrab} onClick={() => app.toggleAddCrab()}>
          <Icon name="crab" /><span>Add a crab</span>
        </button>
        <span className="sep" />
        <button className="icon-btn" aria-label={soundOn ? 'Mute sound' : 'Turn sound on'} aria-pressed={soundOn} title={soundOn ? 'Sound on (M)' : 'Sound off (M)'} onClick={() => app.setSound(!soundOn)}><Icon name={soundOn ? 'soundOn' : 'soundOff'} /></button>
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
