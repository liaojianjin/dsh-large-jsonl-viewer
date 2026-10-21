/** Real Gateway dispatch and lookup; no source fallback or model runtime. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import SessionStore from '@deepseek-ai/dsh-session';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import Gateway from '@deepseek-ai/dsh-api-gateway';
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import WorkspaceFiles from '@deepseek-ai/dsh-api-workspace-files';
import { Peer } from '@deepseek-ai/dsh-client-connection';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol';
import LargeJsonl from '../../packages/plugins/large-jsonl-viewer/lib/index.js';
import { TYPERT } from '../../packages/plugins/large-jsonl-viewer/lib/typert.host.js';

test(
  'strict generated Gateway validates inputs, resolves Session scope and carries cancellation',
  { timeout: 10000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-gateway-')),
      ctx = new Context(),
      abort = new AbortController();
    let peer;
    try {
      await ctx.plugin(SessionStore);
      await ctx.plugin(TypertRegistry);
      await ctx.plugin(RemoteAccess);
      await ctx.plugin(Gateway);
      await ctx.plugin(LocalFileSystem, { cwd: root });
      ctx.provide('sandboxPolicy', { workspaceRoot: root });
      await ctx.plugin(WorkspaceFiles, {
        maxBytes: 1024,
        maxFileBytes: 4096,
        maxLines: 100,
        maxEntries: 100,
      });
      ctx.sessions.create(SessionId('fixture'), { meta: { cwd: root, origin: 'subagent' } });
      ctx.typert.register(TYPERT);
      await ctx.plugin(LargeJsonl, { cacheDirectory: join(root, 'cache') });
      peer = new Peer(ctx, { principal: { kind: 'owner' } });
      await writeFile(join(root, 'a.jsonl'), '{"n":9007199254740993}\r\n');
      const request = (method, args, signal = abort.signal) => ({
        namespace: 'largeJsonl',
        method,
        args,
        peer,
        signal,
      });
      const iterable = await ctx.typertGateway.stream(
        request('watch', { workspaceFileScopeId: 'fixture', path: 'a.jsonl' }),
      );
      const iterator = iterable[Symbol.asyncIterator]();
      let view;
      for await (const value of { [Symbol.asyncIterator]: () => iterator }) {
        view = value;
        if (value.progress.state === 'complete') break;
      }
      // Breaking a `for await` releases its lease, so keep a second live stream for reads.
      const live = await ctx.typertGateway.stream(
        request('watch', { workspaceFileScopeId: 'fixture', path: 'a.jsonl' }),
      );
      const hold = live[Symbol.asyncIterator]();
      view = (await hold.next()).value;
      for (let i = 0; view.progress.lines === 0 && i < 5; i++) view = (await hold.next()).value;
      const args = {
        workspaceFileScopeId: 'fixture',
        viewerId: view.viewerId,
        generation: view.generation,
        line: 1,
        requestId: 1,
      };
      const result = await ctx.typertGateway.invoke(request('readRecord', args));
      assert.equal(result.record.valid, true);
      assert.match(result.record.raw, /9007199254740993/);
      const secondOwner = new Peer(ctx, { principal: { kind: 'owner' } });
      try {
        await assert.rejects(
          ctx.typertGateway.invoke({ ...request('readRecord', args), peer: secondOwner }),
          (error) => remoteErrorOf(error)?.code === 'large-jsonl/view-expired',
        );
      } finally {
        await secondOwner.dispose();
      }
      const bytes = await ctx.typertGateway.invoke(
        request('readExportChunk', {
          workspaceFileScopeId: 'fixture',
          viewerId: view.viewerId,
          token: result.token,
          offset: 0,
          length: 65536,
        }),
      );
      assert.equal(Buffer.from(bytes.data).toString(), '{"n":9007199254740993}\r\n');
      await assert.rejects(
        ctx.typertGateway.invoke(request('readRecord', { ...args, line: '1' })),
        (e) => remoteErrorOf(e)?.code === 'gateway/input-invalid',
      );
      await assert.rejects(
        ctx.typertGateway.invoke(request('readRecord', { ...args, unexpected: true })),
        (e) => remoteErrorOf(e)?.code === 'gateway/arguments-invalid',
      );
      await assert.rejects(
        ctx.typertGateway.invoke(
          request('readRecord', { ...args, workspaceFileScopeId: 'missing' }),
        ),
        (e) => remoteErrorOf(e)?.code === 'gateway/lookup-not-found',
      );
      const guest = new Peer(ctx, { principal: { kind: 'test-guest' } });
      try {
        await assert.rejects(
          ctx.typertGateway.invoke({ ...request('readRecord', args), peer: guest }),
          (e) => remoteErrorOf(e)?.code === 'remote-access/denied',
        );
      } finally {
        await guest.dispose();
      }
      const descriptor = ctx.typert.local.get('largeJsonl/readExportChunk');
      const native = [];
      const encoded = descriptor.result.encode(bytes, (value) => {
        native.push(value);
        return { index: native.length - 1 };
      });
      assert.equal(native.length, 1);
      assert.deepEqual(native[0], bytes.data);
      abort.abort();
      await hold.return?.();
    } finally {
      abort.abort();
      await peer?.dispose();
      await ctx.fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
