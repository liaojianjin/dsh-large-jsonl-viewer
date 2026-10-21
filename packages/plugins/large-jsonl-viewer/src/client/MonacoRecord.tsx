/** The editor model contains only one bounded record. */
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import type { NormalRecord } from '../types.ts';
export interface EditorActions {
  find(): void;
  fold(depth: number): void;
  reveal(line: number, column: number): void;
}
export default function MonacoRecord({
  record,
  raw,
  wrap,
  depth,
  onReady,
  onActions,
  viewState,
  onSave,
}: {
  record: NormalRecord;
  raw: boolean;
  wrap: boolean;
  depth: number;
  onReady(): void;
  onActions(actions: EditorActions | undefined): void;
  viewState?: monaco.editor.ICodeEditorViewState;
  onSave(state: monaco.editor.ICodeEditorViewState): void;
}) {
  const container = useRef<HTMLDivElement>(null),
    editor = useRef<monaco.editor.IStandaloneCodeEditor>();
  const callbacks = useRef({ onReady, onActions });
  callbacks.current = { onReady, onActions };
  useEffect(() => {
    let disposed = false,
      frame = 0;
    if (!monaco.languages.getLanguages().some((language) => language.id === 'json'))
      monaco.languages.register({ id: 'json' });
    const syntax = monaco.languages.setMonarchTokensProvider('json', {
      tokenizer: {
        root: [
          [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'key'],
          [/"(?:[^"\\]|\\.)*"/, 'string'],
          [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
          [/\b(?:true|false|null)\b/, 'keyword'],
          [/[{}\[\]]/, 'delimiter.bracket'],
          [/[:,]/, 'delimiter'],
        ],
      },
    });
    const text = raw ? record.raw : record.formatted;
    const model = monaco.editor.createModel(text, 'json');
    const folding = monaco.languages.registerFoldingRangeProvider('json', {
      provideFoldingRanges(candidate) {
        return candidate === model && !raw && record.valid
          ? record.folds.map((range) => ({
              start: range.start,
              end: range.end,
              kind: monaco.languages.FoldingRangeKind.Region,
            }))
          : [];
      },
    });
    const instance = monaco.editor.create(container.current!, {
      model,
      readOnly: true,
      domReadOnly: true,
      unicodeHighlight: { ambiguousCharacters: false },
      automaticLayout: true,
      wordWrap: wrap ? 'on' : 'off',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      folding: true,
      renderWhitespace: 'none',
      accessibilitySupport: 'auto',
      fixedOverflowWidgets: true,
    });
    editor.current = instance;
    const theme = () =>
      monaco.editor.setTheme(document.body.hasAttribute('data-ds-dark-theme') ? 'vs-dark' : 'vs');
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    const fold = async (value: number) => {
      await instance.getAction('editor.unfoldAll')?.run();
      if (disposed || value === -1 || raw) return;
      const ranges = record.folds.filter((f) => f.depth >= value);
      if (ranges.length)
        await instance.getAction('editor.fold')?.run({
          levels: 1,
          direction: 'down',
          selectionLines: ranges.map((range) => range.start - 1),
        });
      if (disposed) return;
      instance.setSelection(new monaco.Selection(1, 1, 1, 1));
      instance.setScrollTop(0);
    };
    callbacks.current.onActions({
      find() {
        void instance.getAction('actions.find')?.run();
      },
      fold(value) {
        void fold(value);
      },
      reveal(line, column) {
        const ancestors = record.folds
          .filter((range) => range.start < line && range.end >= line)
          .map((range) => range.start - 1);
        void instance
          .getAction('editor.unfold')
          ?.run({ levels: 1, direction: 'down', selectionLines: ancestors })
          .then(() => {
            if (disposed) return;
            instance.setPosition({ lineNumber: line, column });
            instance.revealPositionInCenter({ lineNumber: line, column });
            instance.focus();
          });
      },
    });
    const initialize = viewState
      ? (instance.restoreViewState(viewState), Promise.resolve())
      : fold(depth);
    void initialize.then(() => {
      if (!disposed)
        frame = requestAnimationFrame(() => {
          if (!disposed) onReady();
        });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      const state = instance.saveViewState();
      if (state) onSave(state);
      observer.disconnect();
      callbacks.current.onActions(undefined);
      instance.dispose();
      model.dispose();
      folding.dispose();
      syntax.dispose();
      editor.current = undefined;
    };
  }, [record, raw]);
  useEffect(() => {
    editor.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
  }, [wrap]);
  return <div className="jsonl-monaco" ref={container} />;
}
