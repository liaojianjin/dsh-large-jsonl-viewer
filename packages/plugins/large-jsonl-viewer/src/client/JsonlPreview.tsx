/** Native document renderer. Host snapshots, requests and tab lifetimes stay separate. */
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ViewSnapshot, RecordResult, IndexAction, OutlineNode } from '../types.ts';
import type { ViewerFace } from './face.ts';
import type { Key } from './locales.ts';
import type { EditorActions } from './MonacoRecord.tsx';
import { LargeRecord } from './LargeRecord.tsx';
import { SourceState } from './source-state.ts';
import { randomLine } from './navigation.ts';
const MonacoRecord = lazy(() => import('./MonacoRecord.tsx'));
interface FileSink {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
interface SaveWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<{ createWritable(): Promise<FileSink> }>;
}
export type PreviewProps = Pick<
  DocumentPreviewProps,
  'useTabInfo' | 'resourceAddress' | 'content' | 'wrap'
> &
  ViewerFace &
  PropsLocale<'largeJsonl'>;
export function JsonlPreview(props: PreviewProps) {
  const { tab } = props.useTabInfo(),
    request = props.content.kind === 'renderer' ? props.content : undefined;
  const file = props.sessionId(props.resourceAddress),
    saved = props.getState(tab.id, tab.signal),
    t = (key: Key) => props.t(key);
  const [snapshot, setSnapshot] = useState<ViewSnapshot>(),
    [result, setResult] = useState<RecordResult>(),
    [pending, setPending] = useState<number | undefined>(saved.line),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [changed, setChanged] = useState(false),
    [details, setDetails] = useState(false),
    [outlineDepth, setOutlineDepth] = useState(saved.outlineDepth),
    [input, setInput] = useState(String(saved.line));
  const [, redraw] = useState(0),
    [exporting, setExporting] = useState(false);
  const update = () => redraw((n) => n + 1),
    latest = useRef(props),
    snap = useRef(snapshot),
    shown = useRef(result),
    recordAbort = useRef<AbortController>(),
    exportAbort = useRef<AbortController>(),
    sequence = useRef(0),
    fetching = useRef<number>(),
    editor = useRef<EditorActions>(),
    pendingReveal = useRef<OutlineNode>(),
    pendingTarget = useRef(saved.line),
    life = useRef<AbortController>(),
    generation = useRef(''),
    viewIdentity = useRef(''),
    sourceState = useRef(new SourceState(saved.sourceVersion)),
    carrier = useRef<AbortSignal>(),
    outer = useRef<HTMLDivElement>(null);
  latest.current = props;
  snap.current = snapshot;
  shown.current = result;
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    life.current = controller;
    const signal = AbortSignal.any([controller.signal, tab.signal]);
    setSnapshot(undefined);
    setResult(undefined);
    setPending(pendingTarget.current);
    setError('');
    const stream = props.supervise<ViewSnapshot>({
      name: 'large JSONL preview',
      open: (generationSignal) =>
        props.api.watch(file.sessionId, file.path, AbortSignal.any([generationSignal, signal])),
      ended: () => new Error('File preview stream ended'),
      carrierFailed: () => {
        recordAbort.current?.abort();
        exportAbort.current?.abort();
        setSnapshot(undefined);
        setBusy(false);
        setError(t('reconnecting'));
      },
    });
    void (async () => {
      try {
        for await (const message of stream) {
          if (signal.aborted) break;
          const next = message.value,
            key = next.epoch + ':' + next.generation;
          const replaced = viewIdentity.current !== next.viewerId;
          carrier.current = message.signal;
          if ((generation.current && generation.current !== key) || replaced) {
            recordAbort.current?.abort();
            sequence.current++;
            setResult(undefined);
            if (generation.current && generation.current !== key) {
              saved.history.clear();
              saved.editorStates.clear();
            }
            setPending(pendingTarget.current);
            fetching.current = undefined;
          }
          generation.current = key;
          viewIdentity.current = next.viewerId;
          if (replaced) setError('');
          const observation = sourceState.current.observe(next);
          saved.sourceVersion = sourceState.current.version;
          setChanged(observation.changed);
          if (observation.changed) {
            setPending(undefined);
            setBusy(false);
            saved.history.cancel();
          }
          if (observation.pause) {
            void props.api.controlIndex(
              file.sessionId,
              next.viewerId,
              next.generation,
              'pause',
              signal,
            );
          }
          message.accept();
          setSnapshot(next);
          if (next.progress.state === 'complete' && next.progress.lines === 0) {
            setPending(undefined);
            latest.current.content.kind === 'renderer' &&
              latest.current.content.loaded(next.version);
          }
        }
      } catch (e) {
        if (!signal.aborted) {
          setError(t('unavailable') + ': ' + (e instanceof Error ? e.message : String(e)));
          latest.current.content.kind === 'renderer' && latest.current.content.failed();
        }
      }
    })();
    return () => {
      controller.abort();
      recordAbort.current?.abort();
      exportAbort.current?.abort();
      sourceState.current.cancelRebuild();
      void stream.dispose();
    };
  }, [props.resourceAddress, request?.revision, tab.id, tab.signal, props.api]);
  useEffect(() => {
    const params = tab.navigation.params;
    if (params && 'line' in params && params.line !== undefined) {
      go(params.line);
    }
  }, [tab.navigation.revision]);
  function go(line: number, history = true) {
    if (!Number.isSafeInteger(line) || line < 1) return;
    recordAbort.current?.abort();
    sequence.current++;
    fetching.current = undefined;
    pendingTarget.current = line;
    if (history) saved.history.requestVisit(line);
    setPending(line);
    setInput(String(line));
    setBusy(false);
    setError('');
  }
  function cancel() {
    pendingTarget.current = saved.line;
    recordAbort.current?.abort();
    sequence.current++;
    fetching.current = undefined;
    setPending(undefined);
    setBusy(false);
    saved.history.cancel();
    update();
  }
  useEffect(() => {
    if (!snapshot || pending === undefined || changed || fetching.current === pending) return;
    if (pending > snapshot.progress.lines) {
      if (snapshot.progress.state === 'complete') {
        setError(t('notReady'));
        setPending(undefined);
        saved.history.cancel();
      }
      return;
    }
    const target = pending,
      id = ++sequence.current,
      controller = new AbortController();
    recordAbort.current = controller;
    fetching.current = target;
    setBusy(true);
    const signal = AbortSignal.any([
      controller.signal,
      tab.signal,
      life.current!.signal,
      carrier.current ?? life.current!.signal,
    ]);
    void props.api
      .readRecord(file.sessionId, snapshot.viewerId, snapshot.generation, target, id, signal)
      .then((response) => {
        if (signal.aborted || id !== sequence.current) return;
        fetching.current = undefined;
        setBusy(false);
        if (response.ok) {
          setResult(response.value);
          setPending(undefined);
          saved.line = target;
          setInput(String(target));
        } else {
          setError(t('failed') + ': ' + response.error.code);
          setPending(undefined);
          saved.history.cancel();
          latest.current.content.kind === 'renderer' && latest.current.content.failed();
        }
      });
  }, [snapshot, pending, changed]);
  function ready(token: string) {
    const current = shown.current,
      view = snap.current;
    if (!current || current.token !== token || !view || current.generation !== view.generation)
      return;
    saved.history.commit(current.line);
    if (pendingReveal.current) {
      const node = pendingReveal.current;
      pendingReveal.current = undefined;
      editor.current?.reveal(node.line, node.column);
    }
    if (latest.current.content.kind === 'renderer') latest.current.content.loaded(view.version);
    update();
  }
  async function control(action: IndexAction) {
    if (!snapshot) return;
    const r = await props.api.controlIndex(
      file.sessionId,
      snapshot.viewerId,
      snapshot.generation,
      action,
      life.current?.signal,
    );
    if (!r.ok) setError(t('failed') + ': ' + r.error.code);
  }
  async function rebuild() {
    if (!snapshot) return;
    cancel();
    pendingTarget.current = 1;
    sourceState.current.beginRebuild(snapshot);
    const expectedViewer = snapshot.viewerId,
      signal = life.current!.signal;
    const r = await props.api.rebuild(
      file.sessionId,
      snapshot.viewerId,
      snapshot.generation,
      life.current!.signal,
    );
    if (signal.aborted || snap.current?.viewerId !== expectedViewer) return;
    if (r.ok) {
      saved.history.clear();
      saved.editorStates.clear();
      setChanged(false);
      setResult(undefined);
      setPending(1);
      saved.line = 1;
    } else {
      sourceState.current.cancelRebuild();
      setError(t('failed') + ': ' + r.error.code);
    }
  }
  function move(direction: -1 | 1) {
    const line = saved.history.requestMove(direction);
    if (line !== undefined) go(line, false);
  }
  function depth(n: number) {
    saved.depth = n;
    saved.editorStates.clear();
    editor.current?.fold(n);
    update();
  }
  async function copy() {
    if (changed || result?.record.mode !== 'normal' || result.record.encodingError) return;
    try {
      await navigator.clipboard.writeText(result.record.raw);
      setNotice(t('copied'));
    } catch {
      setError(t('failed'));
    }
  }
  async function exportRecord() {
    if (!snapshot || !result || exporting) return;
    const current = result,
      view = snapshot,
      controller = new AbortController();
    exportAbort.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      tab.signal,
      life.current!.signal,
      carrier.current ?? life.current!.signal,
    ]);
    let sink: FileSink | undefined;
    try {
      const picker = (window as SaveWindow).showSaveFilePicker;
      if (picker)
        sink = await (
          await picker.call(window, { suggestedName: `record-${current.line}.jsonl` })
        ).createWritable();
      else if (current.bytes > 16 * 1024 * 1024) {
        setError(t('exportLimit'));
        return;
      }
      setExporting(true);
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let offset = 0;
      while (true) {
        signal.throwIfAborted();
        const r = await props.api.readExportChunk(
          file.sessionId,
          view.viewerId,
          current.token,
          offset,
          65536,
          signal,
        );
        if (!r.ok) throw new Error(r.error.code);
        if (sink) await sink.write(r.value.data);
        else chunks.push(r.value.data);
        offset += r.value.data.length;
        if (r.value.eof) break;
        if (!r.value.data.length) throw new Error('Unexpected EOF');
      }
      if (sink) await sink.close();
      else {
        const url = URL.createObjectURL(new Blob(chunks)),
          anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `record-${current.line}.jsonl`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      await sink?.abort().catch(() => {});
      if (!signal.aborted && !(e instanceof DOMException && e.name === 'AbortError'))
        setError(t('failed') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }
  function keys(event: KeyboardEvent) {
    if (!event.altKey) return;
    const actions: Record<string, () => void> = {
      ArrowUp: () => go(Math.max(1, saved.line - 1)),
      ArrowDown: () => go(saved.line + 1),
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
    };
    if (actions[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      actions[event.key]();
    }
  }
  function resize(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement,
      start = event.clientX,
      width = saved.width || element.parentElement!.getBoundingClientRect().width;
    element.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      saved.width = Math.max(80, Math.min(400, width + start - e.clientX));
      update();
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('lostpointercapture', end);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('lostpointercapture', end);
  }
  if (!request) return null;
  const stateKey = `${snapshot?.version}:${result?.generation}:${result?.line}:${saved.raw}`;
  const p = snapshot?.progress,
    normal = result?.record.mode === 'normal' ? result.record : undefined;
  return (
    <div
      ref={outer}
      className={'jsonl-viewer' + (saved.focus ? ' jsonl-focus' : '')}
      tabIndex={0}
      onKeyDown={keys}
      data-jsonl-viewer
    >
      <div className="jsonl-toolbar">
        <button title={t('back')} disabled={!saved.history.canGoBack} onClick={() => move(-1)}>
          ←
        </button>
        <button title={t('forward')} disabled={!saved.history.canGoForward} onClick={() => move(1)}>
          →
        </button>
        <button disabled={!p?.lines} onClick={() => go(1)}>
          {t('first')}
        </button>
        <button disabled={saved.line <= 1} onClick={() => go(saved.line - 1)}>
          {t('previous')}
        </button>
        <button
          disabled={p?.state === 'complete' && saved.line >= p.lines}
          onClick={() => go(saved.line + 1)}
        >
          {t('next')}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(input));
          }}
        >
          <input
            type="number"
            min={1}
            step={1}
            aria-label={t('line')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button>{t('go')}</button>
        </form>
        <select
          aria-label={t('line')}
          value={saved.line <= (p?.initialReady ?? 0) ? saved.line : ''}
          onChange={(e) => go(Number(e.target.value))}
        >
          <option value="" disabled>
            —
          </option>
          {Array.from({ length: p?.initialReady ?? 0 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <button
          disabled={!p?.lines}
          title={t('sample')}
          onClick={() => {
            const n = randomLine(p!.lines, saved.line);
            if (n) go(n);
          }}
        >
          {t('random')}
        </button>
        <button disabled={p?.state !== 'complete' || !p.lines} onClick={() => go(p!.lines)}>
          {t('last')}
        </button>
        <details className="jsonl-menu">
          <summary>{t('more')}</summary>
          <div>
            <button
              onClick={() => {
                saved.raw = !saved.raw;
                update();
              }}
            >
              {t(saved.raw ? 'formatted' : 'raw')}
            </button>
            <label>
              {t('depth')}
              <input
                type="number"
                min={-1}
                max={128}
                value={saved.depth}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= -1 && n <= 128) depth(n);
                }}
              />
            </label>
            {(
              [
                ['collapse', 0],
                ['expand1', 1],
                ['expand2', 2],
                ['expandAll', -1],
              ] as const
            ).map(([key, n]) => (
              <button key={key} onClick={() => depth(n)}>
                {t(key)}
              </button>
            ))}
            <button onClick={() => editor.current?.find()} disabled={!normal}>
              {t('find')}
            </button>
            <button disabled={!normal || normal.encodingError} onClick={() => void copy()}>
              {t('copy')}
            </button>
            <button disabled={!result || exporting} onClick={() => void exportRecord()}>
              {t('export')}
            </button>
            <button
              onClick={() => {
                saved.outline = !saved.outline;
                update();
              }}
            >
              {t('outline')}
            </button>
            <button
              onClick={() => {
                saved.focus = !saved.focus;
                update();
              }}
            >
              {t('focus')}
            </button>
          </div>
        </details>
      </div>
      {(pending !== undefined || exporting) && (
        <div className="jsonl-row" role="status">
          <span>
            {exporting ? t('exporting') : busy ? t('loading') : `${t('waiting')} ${pending}`}
          </span>
          <button onClick={() => (exporting ? exportAbort.current?.abort() : cancel())}>
            {t(exporting ? 'cancelExport' : 'cancelJump')}
          </button>
        </div>
      )}
      {error && (
        <div className="jsonl-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}
      {changed ? (
        <div className="jsonl-empty">
          <p>{t('sourceChanged')}</p>
          <button onClick={() => void rebuild()}>{t('rebuild')}</button>
        </div>
      ) : (
        <div className="jsonl-body">
          <main>
            {normal && (
              <>
                {!normal.valid && (
                  <p className="jsonl-error">
                    {t(normal.encodingError ? 'invalidUtf8' : 'invalid')}:{' '}
                    {normal.issues.map((i) => `${i.message} (${i.line}:${i.column})`).join('; ')}
                  </p>
                )}
                {normal.bom && <p>{t('bom')}</p>}
                <Suspense fallback={<p>{t('loading')}</p>}>
                  <MonacoRecord
                    record={normal}
                    raw={saved.raw}
                    wrap={props.wrap}
                    depth={saved.depth}
                    viewState={saved.editorStates.get(stateKey)}
                    onSave={(state) => {
                      const key = stateKey;
                      saved.editorStates.delete(key);
                      saved.editorStates.set(key, state);
                      while (saved.editorStates.size > 10)
                        saved.editorStates.delete(saved.editorStates.keys().next().value!);
                    }}
                    onReady={() => ready(result!.token)}
                    onActions={(actions) => {
                      editor.current = actions;
                    }}
                  />
                </Suspense>
              </>
            )}
            {result?.record.mode === 'large' && snapshot && (
              <LargeRecord
                key={result.token}
                api={props.api}
                sessionId={file.sessionId}
                snapshot={snapshot}
                result={result}
                wrap={props.wrap}
                t={t}
                onReady={() => ready(result.token)}
              />
            )}
            {!result && (
              <div className="jsonl-empty">
                {p?.state === 'complete' && p.lines === 0 ? t('empty') : t('loading')}
              </div>
            )}
          </main>
          {saved.outline && !saved.focus && normal && (
            <aside style={{ width: saved.width || '20%', maxWidth: saved.width ? '40%' : '200px' }}>
              <div className="jsonl-split" onPointerDown={resize} />
              <div className="jsonl-row">
                <strong>{t('outline')}</strong>
                <select
                  aria-label={t('outlineDepth')}
                  value={outlineDepth}
                  onChange={(e) => {
                    saved.outlineDepth = Number(e.target.value);
                    setOutlineDepth(saved.outlineDepth);
                  }}
                >
                  <option>1</option>
                  <option>2</option>
                </select>
              </div>
              {normal.outline
                .filter((n) => n.depth > 0 && n.depth <= outlineDepth)
                .map((node) => (
                  <button
                    key={node.id}
                    className="jsonl-key"
                    style={{ paddingLeft: node.depth * 10 }}
                    onClick={() => {
                      if (saved.raw) {
                        saved.raw = false;
                        pendingReveal.current = node;
                        update();
                      } else editor.current?.reveal(node.line, node.column);
                    }}
                  >
                    {node.key} <small>{node.kind}</small>
                  </button>
                ))}
              {normal.outlineTruncated && <small>{t('truncated')}</small>}
            </aside>
          )}
        </div>
      )}
      {!saved.focus && p && (
        <footer>
          <button onClick={() => setDetails(!details)}>
            {t(p.state)} · {p.lines.toLocaleString()} {t('records')} ·{' '}
            {p.size ? Math.min(100, (100 * p.scannedBytes) / p.size).toFixed(1) : 100}%
          </button>
          {result && (
            <span>
              {t('line')} {result.line} · {result.bytes.toLocaleString()} B
            </span>
          )}
          {details && (
            <section>
              <p>
                {t('bytes')}: {p.scannedBytes.toLocaleString()} / {p.size.toLocaleString()} ·{' '}
                {t('speed')}: {(p.speed / 1048576).toFixed(1)} MiB/s · {t('eta')}:{' '}
                {p.etaSeconds === undefined ? '—' : Math.ceil(p.etaSeconds)}
              </p>
              {p.restored && <p>{t('restored')}</p>}
              {p.warning && (
                <p>
                  {t('temporary')}: {p.warning}
                </p>
              )}
              {p.error && <p role="alert">{p.error}</p>}
              <div className="jsonl-row">
                <button onClick={() => void control('pause')}>{t('pause')}</button>
                <button onClick={() => void control('resume')}>{t('resume')}</button>
                <button onClick={() => void control('cancel')}>{t('cancelIndex')}</button>
                <button onClick={() => void rebuild()}>{t('rebuild')}</button>
              </div>
            </section>
          )}
        </footer>
      )}
    </div>
  );
}
