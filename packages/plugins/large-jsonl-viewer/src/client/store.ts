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
export interface FileBrowserVisibility {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
  setOpen(open: boolean): void;
  getExpanded(workspaceKey: string): readonly string[];
  setExpanded(workspaceKey: string, paths: readonly string[]): void;
  getScrollTop(workspaceKey: string): number | undefined;
  setScrollTop(workspaceKey: string, top: number): void;
}
function newState(): TabState {
  return {
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
}
export function createTabStore() {
  const tabs = new Map<
      string,
      {
        files: Map<string, TabState>;
        signal: AbortSignal;
        forget: () => void;
      }
    >(),
    browserListeners = new Set<() => void>(),
    treePreferences = new Map<string, { expanded: readonly string[]; scrollTop?: number }>();
  let browserOpen = false,
    disposed = false;
  const updateTree = (
    key: string,
    patch: Partial<{ expanded: readonly string[]; scrollTop: number }>,
  ) => {
    if (disposed) return;
    const previous = treePreferences.get(key) ?? { expanded: [] };
    treePreferences.delete(key);
    treePreferences.set(key, { ...previous, ...patch });
    while (treePreferences.size > 32) treePreferences.delete(treePreferences.keys().next().value!);
  };
  const browser: FileBrowserVisibility = {
    getSnapshot: () => browserOpen,
    subscribe(listener) {
      browserListeners.add(listener);
      return () => {
        browserListeners.delete(listener);
      };
    },
    setOpen(open) {
      if (disposed || browserOpen === open) return;
      browserOpen = open;
      for (const listener of browserListeners) listener();
    },
    getExpanded: (workspaceKey) => treePreferences.get(workspaceKey)?.expanded ?? [],
    setExpanded(workspaceKey, paths) {
      // Store names only, never listings or source data. Preferences are bounded across Session working directories.
      updateTree(workspaceKey, { expanded: [...new Set(paths)].slice(-128) });
    },
    getScrollTop: (workspaceKey) => treePreferences.get(workspaceKey)?.scrollTop,
    setScrollTop(workspaceKey, top) {
      if (Number.isFinite(top)) updateTree(workspaceKey, { scrollTop: Math.max(0, top) });
    },
  };
  return {
    browser,
    get(id: string, signal: AbortSignal, resourceAddress = ''): TabState {
      if (disposed || signal.aborted) return newState();
      let tab = tabs.get(id);
      if (tab && tab.signal !== signal) {
        tab.signal.removeEventListener('abort', tab.forget);
        tabs.delete(id);
        tab = undefined;
      }
      if (!tab) {
        const forget = () => {
          if (tabs.get(id)?.signal === signal) tabs.delete(id);
        };
        tab = { files: new Map(), signal, forget };
        tabs.set(id, tab);
        signal.addEventListener('abort', forget, { once: true });
      }
      const state = tab.files.get(resourceAddress) ?? newState();
      tab.files.delete(resourceAddress);
      tab.files.set(resourceAddress, state);
      while (tab.files.size > 32) tab.files.delete(tab.files.keys().next().value!);
      return state;
    },
    dispose() {
      disposed = true;
      for (const { signal, forget } of tabs.values()) signal.removeEventListener('abort', forget);
      tabs.clear();
      browserListeners.clear();
      treePreferences.clear();
    },
  };
}
