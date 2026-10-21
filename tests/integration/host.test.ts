import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, appendFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { LargeJsonl } from '../../packages/plugins/large-jsonl-viewer/lib/index.js';
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ViewSnapshot } from '../../packages/plugins/large-jsonl-viewer/src/types.ts';
async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-jsonl-host-')),
    ctx = new Context();
  const fiber = await ctx.plugin(LocalFileSystem, { cwd: dir });
  const service = new LargeJsonl(ctx, {
    cacheDirectory: join(dir, 'cache'),
    pollMs: 250,
    ...options,
  });
  const scope = { sessionId: SessionId('fixture-session'), workspaceRoot: dir };
  return {
    dir,
    ctx,
    service,
    scope,
    async close() {
      await ctx.fiber.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const signal = () => new AbortController().signal;
async function ready(
  stream: AsyncIterator<ViewSnapshot>,
  predicate = (s: ViewSnapshot) => s.progress.state === 'complete',
) {
  for (let i = 0; i < 100; i++) {
    const item = await stream.next();
    assert.equal(item.done, false);
    if (predicate(item.value)) return item.value;
  }
  throw new Error('Index never ready');
}
test(
  'real filesystem, workers, shared leases, exact export and file invalidation',
  { timeout: 20000 },
  async () => {
    const h = await setup();
    const a = new AbortController(),
      b = new AbortController();
    try {
      const text =
        Array.from({ length: 125 }, (_, i) => `{"n":${i + 1},"big":9007199254740993}`).join(
          '\r\n',
        ) + '\r\n';
      await writeFile(join(h.dir, 'data.jsonl'), text);
      const one = h.service.watch(h.scope, 'data.jsonl', a.signal),
        first = await ready(one);
      assert.equal(first.progress.lines, 125);
      const two = h.service.watch(h.scope, 'data.jsonl', b.signal),
        second = (await two.next()).value;
      assert.ok(second);
      assert.notEqual(first.viewerId, second.viewerId);
      const record = await h.service.readRecord(
        h.scope,
        first.viewerId,
        first.generation,
        101,
        1,
        signal(),
      );
      assert.equal(record.record.mode, 'normal');
      assert.ok(record.record.raw.includes('"n":101'));
      const bytes = await h.service.readExportChunk(
        h.scope,
        first.viewerId,
        record.token,
        0,
        65536,
        signal(),
      );
      assert.equal(Buffer.from(bytes.data).toString(), '{"n":101,"big":9007199254740993}\r\n');
      assert.equal(bytes.eof, true);
      await assert.rejects(
        h.service.readRecord(
          { ...h.scope, sessionId: SessionId('other') },
          first.viewerId,
          first.generation,
          1,
          2,
          signal(),
        ),
        (error) => remoteErrorOf(error)?.code === 'large-jsonl/view-expired',
      );
      a.abort();
      await one.return();
      const other = await h.service.readRecord(
        h.scope,
        second.viewerId,
        second.generation,
        2,
        2,
        signal(),
      );
      assert.equal(other.line, 2);
      await appendFile(join(h.dir, 'data.jsonl'), '{}\n');
      await assert.rejects(
        h.service.readRecord(h.scope, second.viewerId, second.generation, 3, 3, signal()),
        (error) => remoteErrorOf(error)?.code === 'large-jsonl/source-changed',
      );
      b.abort();
      await two.return();
    } finally {
      a.abort();
      b.abort();
      await h.close();
    }
  },
);
test(
  'large records use bounded structure and UTF-8 windows, and cancel releases a worker',
  { timeout: 20000 },
  async () => {
    const h = await setup({ recordLimitMiB: 1 }),
      abort = new AbortController();
    try {
      const text = '{"value":"' + '中😀'.repeat(300000) + '","items":[1,2,3]}';
      await writeFile(join(h.dir, 'large.jsonl'), text);
      const stream = h.service.watch(h.scope, 'large.jsonl', abort.signal),
        view = await ready(stream);
      const record = await h.service.readRecord(
        h.scope,
        view.viewerId,
        view.generation,
        1,
        1,
        signal(),
      );
      assert.equal(record.record.mode, 'large');
      assert.equal(record.record.valid, true);
      assert.equal(record.record.children.length, 2);
      const window = await h.service.readWindow(
        h.scope,
        view.viewerId,
        record.token,
        'raw',
        65535,
        signal(),
      );
      assert.ok(window.text.length < 65536);
      assert.ok(window.next > window.offset);
      const array = record.record.children[1],
        page = await h.service.readNodePage(
          h.scope,
          view.viewerId,
          record.token,
          array.id,
          1,
          signal(),
        );
      assert.equal(page.total, 3);
      assert.equal(page.children[0].preview, '2');
      const cancelled = new AbortController();
      const task = h.service.readRecord(
        h.scope,
        view.viewerId,
        view.generation,
        1,
        2,
        cancelled.signal,
      );
      cancelled.abort();
      await assert.rejects(task);
      const again = await h.service.readRecord(
        h.scope,
        view.viewerId,
        view.generation,
        1,
        3,
        signal(),
      );
      assert.equal(again.record.mode, 'large');
      abort.abort();
      await stream.return();
    } finally {
      abort.abort();
      await h.close();
    }
  },
);
test('source symlinks are refused before indexing', async () => {
  const h = await setup();
  try {
    await writeFile(join(h.dir, 'a.jsonl'), '{}');
    await symlink('a.jsonl', join(h.dir, 'alias.jsonl'));
    const stream = h.service.watch(h.scope, 'alias.jsonl', signal());
    await assert.rejects(
      stream.next(),
      (e) => remoteErrorOf(e)?.code === 'large-jsonl/read-failed',
    );
  } finally {
    await h.close();
  }
});

test(
  'rapid replacement cancels older requests without exhausting a single worker slot',
  { timeout: 20000 },
  async () => {
    const h = await setup({ recordLimitMiB: 1, maxRecordTasks: 1 }),
      abort = new AbortController();
    try {
      await writeFile(
        join(h.dir, 'rapid.jsonl'),
        Array.from({ length: 20 }, (_, i) => '{"n":' + i + '}').join('\n'),
      );
      const stream = h.service.watch(h.scope, 'rapid.jsonl', abort.signal),
        view = await ready(stream);
      const requests = Array.from({ length: 20 }, (_, i) =>
        h.service.readRecord(h.scope, view.viewerId, view.generation, i + 1, i + 1, signal()),
      );
      const settled = await Promise.allSettled(requests);
      assert.equal(settled.at(-1).status, 'fulfilled');
      assert.equal(settled.at(-1).value.line, 20);
      abort.abort();
      await stream.return();
    } finally {
      abort.abort();
      await h.close();
    }
  },
);
test(
  'rebuild replaces generation and old record tokens cannot be reused',
  { timeout: 20000 },
  async () => {
    const h = await setup(),
      abort = new AbortController();
    try {
      await writeFile(join(h.dir, 'changed.jsonl'), '1\n2\n');
      const stream = h.service.watch(h.scope, 'changed.jsonl', abort.signal),
        view = await ready(stream);
      const old = await h.service.readRecord(
        h.scope,
        view.viewerId,
        view.generation,
        1,
        1,
        signal(),
      );
      await writeFile(join(h.dir, 'changed.jsonl'), '3\n4\n5\n');
      await h.service.rebuild(h.scope, view.viewerId, view.generation, signal());
      const rebuilt = await ready(stream);
      assert.ok(rebuilt.generation > view.generation);
      assert.equal(rebuilt.progress.lines, 3);
      await assert.rejects(
        h.service.readExportChunk(h.scope, view.viewerId, old.token, 0, 65536, signal()),
        (e) => remoteErrorOf(e)?.code === 'large-jsonl/stale-record',
      );
      const current = await h.service.readRecord(
        h.scope,
        view.viewerId,
        rebuilt.generation,
        3,
        2,
        signal(),
      );
      assert.equal(current.record.raw, '5');
      abort.abort();
      await stream.return();
    } finally {
      abort.abort();
      await h.close();
    }
  },
);

test(
  'view admission is bounded and closing a lease permits another view',
  { timeout: 10000 },
  async () => {
    const h = await setup({ maxViews: 1 }),
      abort = new AbortController();
    try {
      await writeFile(join(h.dir, 'bounded.jsonl'), '{}\n');
      const first = h.service.watch(h.scope, 'bounded.jsonl', abort.signal);
      await ready(first);
      await assert.rejects(
        h.service.watch(h.scope, 'bounded.jsonl', signal()).next(),
        (e) => remoteErrorOf(e)?.code === 'large-jsonl/busy',
      );
      abort.abort();
      await first.return();
      const second = h.service.watch(h.scope, 'bounded.jsonl', signal());
      const view = await ready(second);
      assert.equal(view.progress.restored, true);
      await second.return();
    } finally {
      abort.abort();
      await h.close();
    }
  },
);

test(
  'sparse byte reads and uint64 offsets preserve positions above 4 GiB',
  { timeout: 10000 },
  async () => {
    const h = await setup();
    try {
      const { open } = await import('node:fs/promises');
      const { Source } = await import(
        '../../packages/plugins/large-jsonl-viewer/src/host/source.ts'
      );
      const { OffsetStore } = await import(
        '../../packages/plugins/large-jsonl-viewer/src/core/index/store.ts'
      );
      const position = 2 ** 32 + 123,
        bytes = Buffer.from('{"unicode":"中😀"}\n'),
        path = join(h.dir, 'sparse.jsonl'),
        handle = await open(path, 'wx');
      try {
        await handle.truncate(position + bytes.length);
        await handle.write(bytes, 0, bytes.length, position);
      } finally {
        await handle.close();
      }
      const source = await Source.open(h.ctx.fs, h.scope, 'sparse.jsonl', signal());
      assert.deepEqual(Buffer.from(await source.read(position, bytes.length, signal())), bytes);
      const store = new OffsetStore(join(h.dir, 'offsets'), source.identity);
      await store.initialize();
      await store.append(position);
      await store.append(position + bytes.length);
      assert.deepEqual(await store.range(2), [position, position + bytes.length]);
    } finally {
      await h.close();
    }
  },
);

test(
  'a configured 16 MiB ordinary budget reads more than one bridge chunk',
  { timeout: 15000 },
  async () => {
    const h = await setup({ recordLimitMiB: 16 }),
      abort = new AbortController();
    try {
      const text = '{"value":"' + 'x'.repeat(9 * 1024 * 1024) + '"}';
      await writeFile(join(h.dir, 'ordinary.jsonl'), text);
      const stream = h.service.watch(h.scope, 'ordinary.jsonl', abort.signal),
        view = await ready(stream);
      const record = await h.service.readRecord(
        h.scope,
        view.viewerId,
        view.generation,
        1,
        1,
        signal(),
      );
      assert.equal(record.record.mode, 'normal');
      assert.equal(record.record.raw.length, text.length);
      abort.abort();
      await stream.return();
    } finally {
      abort.abort();
      await h.close();
    }
  },
);

test(
  'overlapping close and reopen waits for the previous writer and restores its cache',
  { timeout: 15000 },
  async () => {
    const h = await setup({ maxFiles: 1 });
    try {
      await writeFile(join(h.dir, 'reopen.jsonl'), '{}\n');
      let stream = h.service.watch(h.scope, 'reopen.jsonl', signal());
      await ready(stream);
      for (let i = 0; i < 5; i++) {
        const closing = stream.return();
        const next = h.service.watch(h.scope, 'reopen.jsonl', signal());
        const snapshot = await ready(next);
        await closing;
        assert.equal(snapshot.progress.restored, true);
        assert.equal(snapshot.progress.warning, undefined);
        stream = next;
      }
      await stream.return();
    } finally {
      await h.close();
    }
  },
);
