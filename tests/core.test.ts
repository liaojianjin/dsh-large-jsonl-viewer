import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processRecord } from '../packages/plugins/large-jsonl-viewer/src/core/json/normal.ts';
import { streamPage } from '../packages/plugins/large-jsonl-viewer/src/core/json/stream.ts';
import { OffsetStore } from '../packages/plugins/large-jsonl-viewer/src/core/index/store.ts';
import {
  scanFile,
  type ScanControl,
} from '../packages/plugins/large-jsonl-viewer/src/core/index/scanner.ts';
import {
  decodeRecord,
  readExactly,
  type RangeReader,
} from '../packages/plugins/large-jsonl-viewer/src/core/io/reader.ts';
import {
  RecordHistory,
  randomLine,
} from '../packages/plugins/large-jsonl-viewer/src/client/navigation.ts';
function reader(bytes: Buffer, short = false): RangeReader {
  return {
    async read(buffer, offset, length, position) {
      const n = Math.min(short ? 2 : length, length, bytes.length - position);
      if (n > 0) buffer.set(bytes.subarray(position, position + n), offset);
      return { bytesRead: Math.max(0, n) };
    },
    async validate() {},
  };
}
const identity = (size: number) => ({ size, version: 'v1', target: 'opaque', fingerprint: 'abc' });
test('formatting preserves number lexemes, duplicate keys, order and escapes', () => {
  const raw = '{"z":9007199254740993,"a":-0,"a":1.234567890123456789,"b":1e+999,"c":"\\u4e2d😀"}';
  const result = processRecord(raw);
  assert.equal(result.valid, true);
  assert.equal(result.formatted.replace(/\s/g, ''), raw);
  assert.equal(result.outline.filter((n) => n.key === 'a').length, 2);
});
test('JSON errors remain per-record and strict', () => {
  for (const raw of ['', '  ', '{"a":1,}', '/*comment*/{}', '01', '[true false]'])
    assert.equal(processRecord(raw).valid, false, raw);
});
test('short reads, UTF-8/BOM and CRLF retain physical content semantics', async () => {
  const bytes = Buffer.from('\ufeff{"中":"😀"}\r\n');
  const buffer = Buffer.alloc(bytes.length);
  await readExactly(reader(bytes, true), buffer, 0);
  assert.deepEqual(buffer, bytes);
  assert.deepEqual(decodeRecord(buffer, true), { raw: '{"中":"😀"}', bom: true });
  assert.throws(() => decodeRecord(Buffer.from([0xff]), false));
});
test('index agrees with independent line boundaries across 3-byte blocks and restart', async () => {
  for (const text of ['', '{}', '{}\n', '{}\r\n\nnull\n', '\n\n', '{"中":"😀"}\n2']) {
    const directory = await mkdtemp(join(tmpdir(), 'jsonl-core-'));
    try {
      const bytes = Buffer.from(text),
        control: ScanControl = { state: 'running', wait: async () => {} };
      const store = await scanFile({
        reader: reader(bytes, true),
        source: identity(bytes.length),
        directory,
        maxOffsets: 100,
        chunkBytes: 3,
        control,
        progress() {},
      });
      const expected: number[] = [0];
      for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) expected.push(i + 1);
      if (expected.at(-1) !== bytes.length) expected.push(bytes.length);
      assert.equal(store.count, expected.length, text);
      for (let i = 0; i < expected.length; i++) assert.equal(await store.get(i), expected[i]);
      const restored = new OffsetStore(directory, identity(bytes.length));
      await restored.initialize();
      assert.equal(restored.restored, true);
      assert.equal(restored.complete, true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
test('cache page corruption is refused and offset limits are enforced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jsonl-cache-'));
  try {
    const store = new OffsetStore(directory, identity(10), 3);
    await store.initialize();
    await store.append(2);
    await store.append(4);
    await assert.rejects(store.append(6), /limit/);
    await store.checkpoint(false);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    await writeFile(join(directory, manifest.pages[0].file), Buffer.from('broken'));
    const restored = new OffsetStore(directory, identity(10), 3);
    await restored.initialize();
    assert.equal(restored.restored, false);
    assert.equal(restored.count, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('streaming pagination is strict and bounded without parsing numbers', async () => {
  const bytes = Buffer.from('{"a":[1,2],"a":9007199254740993,"中":"😀"}');
  const page = await streamPage({
    reader: reader(bytes, true),
    start: 0,
    end: bytes.length,
    chunkBytes: 3,
    limit: 2,
  });
  assert.equal(page.valid, true);
  assert.equal(page.total, 3);
  assert.equal(page.children.length, 2);
  assert.equal(page.children[1].preview, '9007199254740993');
  const second = await streamPage({ reader: reader(bytes), start: 0, end: bytes.length, skip: 2 });
  assert.equal(second.children[0].key, '中');
  for (const text of ['[1,]', '{"x":}', '"bad\nvalue"', '{"a":01}']) {
    const b = Buffer.from(text);
    assert.equal(
      (await streamPage({ reader: reader(b), start: 0, end: b.length, chunkBytes: 1 })).valid,
      false,
    );
  }
});
test('history commits only successful display and random positions avoid 32-bit truncation', () => {
  const history = new RecordHistory();
  [1, 9, 20].forEach((n) => history.commit(n));
  history.requestMove(-1);
  history.commit(9);
  history.requestVisit(33);
  history.cancel();
  assert.equal(history.canGoForward, true);
  history.requestVisit(44);
  history.commit(44);
  assert.deepEqual(history.snapshot().entries, [1, 9, 44]);
  assert.ok(randomLine(2 ** 33, 1, () => 0.99)! > 2 ** 32);
});

test('explicit source rebuild accepts its new generation before or after unary acknowledgement', async () => {
  const { SourceState } = await import(
    '../packages/plugins/large-jsonl-viewer/src/client/source-state.ts'
  );
  for (const acknowledgementFirst of [true, false]) {
    const state = new SourceState('old');
    const snapshot = {
      epoch: 'host',
      generation: 1,
      version: 'new',
      progress: { state: 'paused' },
    };
    assert.deepEqual(state.observe(snapshot), { changed: true, pause: true });
    assert.deepEqual(state.observe(snapshot), { changed: true, pause: false });
    state.beginRebuild(snapshot);
    if (acknowledgementFirst) {
      assert.equal(state.version, 'old');
    }
    assert.deepEqual(
      state.observe({ ...snapshot, generation: 2, progress: { state: 'indexing' } }),
      { changed: false, pause: false },
    );
    assert.equal(state.version, 'new');
    assert.deepEqual(
      state.observe({ ...snapshot, generation: 2, progress: { state: 'complete' } }),
      { changed: false, pause: false },
    );
  }
});
