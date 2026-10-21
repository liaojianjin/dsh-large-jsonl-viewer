/** Large containers and scalars are explored with bounded pages/windows. */
import { useEffect, useRef, useState } from 'react';
import type { LargePage, TextWindow, ViewSnapshot, RecordResult } from '../types.ts';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ViewerFace } from './face.ts';
import type { Key } from './locales.ts';
export function LargeRecord({
  api,
  sessionId,
  snapshot,
  result,
  wrap,
  t,
  onReady,
}: {
  api: ViewerFace['api'];
  sessionId: SessionId;
  snapshot: ViewSnapshot;
  result: RecordResult;
  wrap: boolean;
  t: (key: Key) => string;
  onReady(): void;
}) {
  const initial = result.record as LargePage;
  const [page, setPage] = useState(initial),
    [trail, setTrail] = useState<LargePage[]>([]),
    [window, setWindow] = useState<TextWindow>(),
    [windowNode, setWindowNode] = useState('raw'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [controller] = useState(() => new AbortController());
  const active = useRef<AbortController>();
  const sequence = useRef(0);
  useEffect(() => {
    onReady();
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [result]);
  async function load(node: string, skip = 0, push = false) {
    active.current?.abort();
    const request = new AbortController(),
      id = ++sequence.current;
    active.current = request;
    setBusy(true);
    setError('');
    const response = await api.readNodePage(
      sessionId,
      snapshot.viewerId,
      result.token,
      node,
      skip,
      AbortSignal.any([controller.signal, request.signal]),
    );
    if (controller.signal.aborted || request.signal.aborted || id !== sequence.current) return;
    setBusy(false);
    if (response.ok) {
      if (push) setTrail((v) => [...v, page].slice(-18));
      setPage(response.value);
    } else setError(t('failed') + ': ' + response.error.code);
  }
  async function text(node: string, offset = 0) {
    active.current?.abort();
    const request = new AbortController(),
      id = ++sequence.current;
    active.current = request;
    setBusy(true);
    setError('');
    const response = await api.readWindow(
      sessionId,
      snapshot.viewerId,
      result.token,
      node,
      offset,
      AbortSignal.any([controller.signal, request.signal]),
    );
    if (controller.signal.aborted || request.signal.aborted || id !== sequence.current) return;
    setBusy(false);
    if (response.ok) {
      setWindowNode(node);
      setWindow(response.value);
    } else setError(t('failed') + ': ' + response.error.code);
  }
  return (
    <div className="jsonl-large">
      <div className="jsonl-row">
        <strong>{t('large')}</strong>
        <button onClick={() => void text('raw')}>{t('raw')}</button>
        {trail.length > 0 && (
          <button
            onClick={() => {
              setPage(trail.at(-1)!);
              setTrail((v) => v.slice(0, -1));
            }}
          >
            {t('back')}
          </button>
        )}
      </div>
      {page.error && (
        <p role="alert">
          {t('invalid')}: {page.error}
        </p>
      )}
      <div className="jsonl-node">
        <span>
          {page.root.key} ({page.root.kind})
        </span>
        <button onClick={() => void text(page.root.id)}>{t('showText')}</button>
      </div>
      {page.children.map((node) => (
        <div className="jsonl-node" key={node.id}>
          <button
            disabled={busy}
            onClick={() =>
              void (node.kind === 'object' || node.kind === 'array'
                ? load(node.id, 0, true)
                : text(node.id))
            }
          >
            {node.key}{' '}
            <span>
              {node.kind} {node.count ?? ''}
            </span>
          </button>
          <code>{node.preview}</code>
        </div>
      ))}
      <div className="jsonl-row">
        <button
          disabled={busy || page.skip === 0}
          onClick={() => void load(page.root.id, Math.max(0, page.skip - 100))}
        >
          {t('previousPage')}
        </button>
        <span>
          {page.total ? page.skip + 1 : 0}–{Math.min(page.skip + 100, page.total)} / {page.total}
        </span>
        <button
          disabled={busy || page.skip + 100 >= page.total}
          onClick={() => void load(page.root.id, page.skip + 100)}
        >
          {t('nextPage')}
        </button>
      </div>
      {busy && <p role="status">{t('checking')}</p>}
      {error && <p role="alert">{error}</p>}
      {window && (
        <section>
          <div className="jsonl-row">
            <strong>
              {t('window')} {window.offset} / {window.total}
            </strong>
            <button onClick={() => setWindow(undefined)}>{t('close')}</button>
            <button
              disabled={busy || !window.offset}
              onClick={() => void text(windowNode, Math.max(0, window.offset - 65536))}
            >
              {t('previousPage')}
            </button>
            <button
              disabled={busy || window.next >= window.total}
              onClick={() => void text(windowNode, window.next)}
            >
              {t('nextPage')}
            </button>
          </div>
          <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{window.text}</pre>
        </section>
      )}
    </div>
  );
}
