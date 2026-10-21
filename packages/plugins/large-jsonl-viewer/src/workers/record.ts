/** Bounded ordinary parsing or incremental large-record traversal. */
import { parentPort, workerData } from 'node:worker_threads';
import { decodeRecord, readExactly } from '../core/io/reader.ts';
import { processRecord, RecordBudgetError } from '../core/json/normal.ts';
import { streamPage } from '../core/json/stream.ts';
import { reader } from './reader.ts';
import type { NormalRecord } from '../types.ts';
async function main(): Promise<void> {
  const { start, end, firstLine, limitBytes, task, skip, offset } = workerData;
  if (task === 'window') {
    const beginAt = Math.min(end, start + offset),
      bytes = Buffer.alloc(Math.min(65536, end - beginAt));
    await readExactly(reader, bytes, beginAt);
    let begin = 0,
      finish = bytes.length;
    while (begin < finish && (bytes[begin] & 0xc0) === 0x80) begin++;
    if (beginAt + finish < end) {
      let last = finish - 1;
      while (last >= begin && (bytes[last] & 0xc0) === 0x80) last--;
      if (last >= begin) {
        const b = bytes[last],
          needed = b < 128 ? 1 : b < 224 ? 2 : b < 240 ? 3 : 4;
        if (finish - last < needed) finish = last;
      }
    }
    let text: string;
    try {
      text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(begin, finish),
      );
    } catch {
      text = '[invalid UTF-8; hex]\n' + bytes.subarray(0, 4096).toString('hex');
    }
    parentPort!.postMessage({
      type: 'result',
      value: { text, offset: offset + begin, next: offset + finish, total: end - start },
    });
    return;
  }
  if (task === 'record' && end - start <= limitBytes) {
    const bytes = Buffer.alloc(end - start);
    await readExactly(reader, bytes, start);
    let record: NormalRecord | undefined;
    try {
      const { raw, bom } = decodeRecord(bytes, firstLine);
      record = processRecord(raw, bom);
    } catch (error) {
      if (!(error instanceof RecordBudgetError))
        record = {
          mode: 'normal',
          raw: bytes.subarray(0, 4096).toString('hex'),
          formatted: bytes.subarray(0, 4096).toString('hex'),
          valid: false,
          bom: false,
          outline: [],
          folds: [],
          issues: [{ message: 'Invalid UTF-8 (bounded hex preview)', line: 1, column: 1 }],
          outlineTruncated: false,
          encodingError: true,
        };
    }
    if (record) {
      parentPort!.postMessage({ type: 'result', value: record });
      return;
    }
  }
  const page = await streamPage({
    reader,
    start,
    end,
    firstLine,
    skip,
    update(page) {
      parentPort!.postMessage({ type: 'progress', page });
    },
  });
  parentPort!.postMessage({ type: 'result', value: page });
}
void main()
  .catch((error: Error) => parentPort!.postMessage({ type: 'failure', error: error.message }))
  .finally(() => parentPort!.close());
