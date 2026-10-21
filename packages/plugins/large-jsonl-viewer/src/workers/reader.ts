/** One outstanding byte request per worker provides source-read backpressure. */
import { parentPort } from 'node:worker_threads';
import type { RangeReader } from '../core/io/reader.ts';
let sequence = 0;
const pending = new Map<number, { resolve(value: Uint8Array): void; reject(error: Error): void }>();
parentPort!.on('message', (m: { type: string; id: number; bytes?: Uint8Array; error?: string }) => {
  if (m.type !== 'sourceResult') return;
  const request = pending.get(m.id);
  pending.delete(m.id);
  if (m.error) request?.reject(new Error(m.error));
  else request?.resolve(m.bytes ?? new Uint8Array());
});
function request(offset: number, length: number): Promise<Uint8Array> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    parentPort!.postMessage({ type: 'source', id, offset, length });
  });
}
export const reader: RangeReader = {
  async read(buffer, offset, length, position) {
    const bytes = await request(position, Math.min(length, 8 * 1024 * 1024));
    if (bytes.length > length) throw new Error('Oversized byte response');
    buffer.set(bytes, offset);
    return { bytesRead: bytes.length };
  },
  async validate() {
    await request(0, 0);
  },
};
