/** Lightweight tab preferences survive body remounts; source content is never persisted. */
import type { editor } from 'monaco-editor/editor/editor.api.js';
import { RecordHistory } from './navigation.ts';
export interface TabState {
  line: number;
  raw: boolean;
  depth: number;
  outlineDepth: number;
  outline: boolean;
  focus: boolean;
  width: number;
  history: RecordHistory;
  sourceVersion?: string;
  editorStates: Map<string, editor.ICodeEditorViewState>;
}
export function createTabStore() {
  const states = new Map<string, TabState>(),
    listeners = new Map<string, { signal: AbortSignal; forget: () => void }>();
  return {
    get(id: string, signal: AbortSignal): TabState {
      let state = states.get(id);
      if (!state) {
        state = {
          line: 1,
          raw: false,
          depth: 2,
          outlineDepth: 2,
          outline: true,
          focus: false,
          width: 0,
          history: new RecordHistory(),
          editorStates: new Map(),
        };
        states.set(id, state);
        const forget = () => {
          states.delete(id);
          listeners.delete(id);
        };
        listeners.set(id, { signal, forget });
        signal.addEventListener('abort', forget, { once: true });
      }
      return state;
    },
    dispose() {
      for (const { signal, forget } of listeners.values())
        signal.removeEventListener('abort', forget);
      states.clear();
      listeners.clear();
    },
  };
}
