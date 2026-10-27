import { useSyncExternalStore } from 'react';

/** Minimal external store: React reads it through useSyncExternalStore. */

/** What is selected: only crabs can be (lines belong to the sand). */
export type Selection = { kind: 'crab'; id: number } | null;

export interface AppState {
  readonly selection: Selection;
  readonly hasDrawn: boolean;
  /** Lines still in the sand that undo could smooth over. */
  readonly undoable: number;
  readonly uiHidden: boolean;
  readonly toast: { id: number; text: string } | null;
  readonly loading: boolean;
  readonly recording: boolean;
  readonly fatal: string | null;
  /** Bumped when a crab's mode changes, so its action bar can re-read it. */
  readonly crabTick: number;
  /** "Add a crab" is on: the next closed shape drawn hatches one. */
  readonly addingCrab: boolean;
  readonly crabCount: number;
  readonly soundOn: boolean;
}

type Listener = () => void;

export class Store {
  private state: AppState = {
    selection: null,
    hasDrawn: false,
    undoable: 0,
    uiHidden: false,
    toast: null,
    loading: true,
    recording: false,
    fatal: null,
    crabTick: 0,
    addingCrab: false,
    crabCount: 4,
    soundOn: true,
  };
  private readonly listeners = new Set<Listener>();
  private toastId = 0;

  get = (): AppState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  toast(text: string): void {
    this.set({ toast: { id: ++this.toastId, text } });
  }
}

export function useAppState<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
