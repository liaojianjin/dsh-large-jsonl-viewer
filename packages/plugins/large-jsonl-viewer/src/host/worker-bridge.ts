/** Source bytes cross one bounded request at a time, never an OS source path. */
import { Worker } from 'node:worker_threads';
import type { Source } from './source.ts';
export interface WorkerMessage {
  type: string;
  id?: number;
  offset?: number;
  length?: number;
  error?: string;
  value?: unknown;
  [key: string]: unknown;
}
export function sourceWorker(
  url: URL,
  data: object,
  source: Source,
  signal: AbortSignal,
  bounds: [number, number],
): Worker {
  signal.throwIfAborted();
  const worker = new Worker(url, {
    workerData: data,
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  let reading = false;
  worker.on('message', (m: WorkerMessage) => {
    if (!m || typeof m !== 'object' || m.type !== 'source') return;
    if (
      reading ||
      !Number.isSafeInteger(m.id) ||
      !Number.isSafeInteger(m.offset) ||
      !Number.isSafeInteger(m.length) ||
      m.length! < 0 ||
      m.length! > 8 * 1024 * 1024 ||
      m.offset! < 0 ||
      (m.length! > 0 && (m.offset! < bounds[0] || m.offset! + m.length! > bounds[1]))
    ) {
      worker.postMessage({
        type: 'sourceResult',
        id: m.id,
        error: 'Invalid or overlapping worker source request',
      });
      return;
    }
    reading = true;
    void (async () => {
      try {
        const bytes =
          m.length === 0
            ? (await source.validate(signal), new Uint8Array())
            : new Uint8Array(await source.read(m.offset!, m.length!, signal));
        if (!signal.aborted)
          worker.postMessage({ type: 'sourceResult', id: m.id, bytes }, [bytes.buffer]);
      } catch (error) {
        if (!signal.aborted)
          worker.postMessage({
            type: 'sourceResult',
            id: m.id,
            error: error instanceof Error ? error.message : String(error),
          });
      } finally {
        reading = false;
      }
    })();
  });
  const abort = () => {
    void worker.terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  worker.once('exit', () => signal.removeEventListener('abort', abort));
  return worker;
}
