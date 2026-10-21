/** Background byte indexing; source reads are delegated to the owning Host. */
import { parentPort, workerData } from 'node:worker_threads';
import { scanFile, type ScanControl } from '../core/index/scanner.ts';
import type { OffsetStore } from '../core/index/store.ts';
import { reader } from './reader.ts';
const port = parentPort!;
let store: OffsetStore | undefined, wake: (() => void) | undefined;
const control: ScanControl = {
  state: 'running',
  wait: () =>
    new Promise((resolve) => {
      wake = resolve;
    }),
};
port.on(
  'message',
  async (m: {
    type: string;
    id: number;
    line: number;
    state: ScanControl['state'];
    busy: boolean;
  }) => {
    if (m.type === 'range') {
      try {
        port.postMessage({ type: 'range', id: m.id, range: await store!.range(m.line) });
      } catch (error) {
        port.postMessage({ type: 'range', id: m.id, error: String(error) });
      }
    } else if (m.type === 'foreground') control.foreground = m.busy;
    else if (m.type === 'control') {
      control.state = m.state;
      wake?.();
      wake = undefined;
      if (control.state === 'disposed' && store?.complete) port.close();
    }
  },
);
void scanFile({
  ...workerData,
  reader,
  control,
  initialized(s) {
    store = s;
  },
  progress(progress) {
    port.postMessage({ type: 'progress', progress });
  },
})
  .then(() => {
    if (control.state === 'disposed') port.close();
  })
  .catch((error: Error) => port.postMessage({ type: 'failure', error: error.message }));
