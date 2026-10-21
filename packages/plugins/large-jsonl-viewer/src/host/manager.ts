/** File-level indexing is shared; leases and record tokens remain Session-owned. */
import { randomUUID } from 'node:crypto';
import type { Worker } from 'node:worker_threads';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files';
import type { Config } from '../config.ts';
import type {
  ExportChunk,
  IndexAction,
  LargeNode,
  LargePage,
  NormalRecord,
  Progress,
  RecordResult,
  TextWindow,
  ViewSnapshot,
} from '../types.ts';
import { Source, SourceChanged } from './source.ts';
import { acquireCache, prepareCache, prune, type CacheLease } from './cache.ts';
import { sourceWorker, type WorkerMessage } from './worker-bridge.ts';

const initial = (): Progress => ({
  state: 'indexing',
  size: 0,
  scannedBytes: 0,
  lines: 0,
  initialReady: 0,
  speed: 0,
  elapsedMs: 0,
  restored: false,
});
export class ViewerError extends Error {
  constructor(
    readonly code:
      | 'source-changed'
      | 'view-expired'
      | 'stale-record'
      | 'line-not-ready'
      | 'line-out-of-range'
      | 'busy'
      | 'limit-exceeded',
    message: string,
  ) {
    super(message);
  }
}
interface RecordToken {
  generation: number;
  start: number;
  end: number;
  nodes: Map<string, LargeNode>;
}
interface View {
  session: string;
  owner: string;
  file: IndexedFile;
  tokens: Map<string, RecordToken>;
  task?: AbortController;
  navigation?: AbortController;
  latestRequestId: number;
  pending?: Promise<void>;
  serial: number;
}

class IndexedFile {
  generation = 1;
  progress = initial();
  leases = 0;
  private life = new AbortController();
  private worker?: Worker;
  private cache?: CacheLease;
  private timer?: ReturnType<typeof setInterval>;
  private pending = new Map<
    number,
    { resolve(value: [number, number]): void; reject(error: Error): void }
  >();
  private sequence = 0;
  private listeners = new Set<() => void>();
  private closing?: Promise<void>;
  private stopping = false;
  private exited = false;
  private busy = 0;
  constructor(
    public source: Source,
    readonly config: Config,
    readonly epoch: string,
  ) {}
  get isClosing(): boolean {
    return this.stopping;
  }
  async start(reset = false): Promise<void> {
    this.exited = false;
    this.progress = { ...initial(), size: this.source.identity.size };
    this.cache = await acquireCache(
      this.config,
      `${this.source.scope.sessionId}\0${this.source.identity.target}`,
    );
    if (this.life.signal.aborted) {
      await this.cache.release();
      return;
    }
    try {
      await prepareCache(this.cache.directory, this.source.identity, reset);
    } catch (error) {
      await this.cache.release();
      throw error;
    }
    this.worker = sourceWorker(
      new URL('./workers/index.mjs', import.meta.url),
      {
        source: this.source.identity,
        directory: this.cache.directory,
        chunkBytes: this.config.scanChunkMiB * 1024 * 1024,
        maxOffsets: this.config.maxLines + 1,
      },
      this.source,
      this.life.signal,
      [0, this.source.identity.size],
    );
    this.worker.on('message', (m: WorkerMessage) => {
      if (
        m.type === 'progress' &&
        !this.stopping &&
        !['changed', 'error'].includes(this.progress.state)
      ) {
        this.progress = {
          ...(m.progress as Progress),
          warning: this.cache?.warning ?? (m.progress as Progress).warning,
        };
        this.publish();
      }
      if (m.type === 'failure') this.fail(String(m.error));
      if (m.type === 'range') {
        const item = this.pending.get(m.id!);
        this.pending.delete(m.id!);
        if (m.error) item?.reject(new Error(m.error));
        else item?.resolve(m.range as [number, number]);
      }
    });
    this.worker.on('error', (error) => this.fail(error.message));
    this.worker.on('exit', () => {
      this.exited = true;
      if (!this.life.signal.aborted && !this.stopping)
        this.fail('Index worker stopped unexpectedly');
    });
    this.timer = setInterval(() => {
      void this.source.validate(this.life.signal).catch((error) => {
        if (!this.life.signal.aborted) this.fail(String(error), true);
      });
    }, this.config.pollMs);
    this.timer.unref();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(): void {
    for (const listener of this.listeners) listener();
  }
  fail(error: string, changed = error.includes('Source file changed')): void {
    if (this.progress.state === 'changed' || this.progress.state === 'error') return;
    this.progress = {
      ...this.progress,
      state: changed ? 'changed' : 'error',
      error,
      speed: 0,
      etaSeconds: undefined,
    };
    for (const p of this.pending.values()) p.reject(new Error(error));
    this.pending.clear();
    if (changed) this.life.abort();
    this.publish();
  }
  async validate(signal: AbortSignal): Promise<void> {
    if (this.progress.state === 'changed')
      throw new ViewerError('source-changed', this.progress.error!);
    try {
      await this.source.validate(signal);
    } catch (error) {
      if (error instanceof SourceChanged) {
        this.fail(error.message, true);
        throw new ViewerError('source-changed', error.message);
      }
      throw error;
    }
  }
  async range(line: number, signal: AbortSignal): Promise<[number, number]> {
    await this.validate(signal);
    if (this.exited)
      throw new ViewerError('view-expired', 'Index worker is unavailable; rebuild the index');
    if (!Number.isSafeInteger(line) || line < 1)
      throw new ViewerError('line-out-of-range', 'Invalid physical line');
    if (line > this.progress.lines)
      throw new ViewerError(
        this.progress.state === 'complete' ? 'line-out-of-range' : 'line-not-ready',
        'Requested line is not indexed',
      );
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: (v) => {
          signal.removeEventListener('abort', abort);
          resolve(v);
        },
        reject: (e) => {
          signal.removeEventListener('abort', abort);
          reject(e);
        },
      });
      if (signal.aborted) {
        abort();
        return;
      }
      this.worker!.postMessage({ type: 'range', id, line });
    });
  }
  control(action: IndexAction): void {
    this.worker?.postMessage({
      type: 'control',
      state: action === 'resume' ? 'running' : action === 'pause' ? 'paused' : 'cancelled',
    });
  }
  foreground(busy: boolean): void {
    this.busy = Math.max(0, this.busy + (busy ? 1 : -1));
    this.worker?.postMessage({ type: 'foreground', busy: this.busy > 0 });
  }
  async rebuild(fs: FileSystem, signal: AbortSignal): Promise<void> {
    const source = await Source.open(fs, this.source.scope, this.source.path, signal);
    await this.stop();
    this.generation++;
    this.life = new AbortController();
    this.closing = undefined;
    this.stopping = false;
    this.busy = 0;
    this.source = source;
    await this.start(true);
    this.publish();
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true;
    this.closing = (async () => {
      if (this.timer) clearInterval(this.timer);
      for (const item of this.pending.values()) item.reject(new Error('Viewer closed'));
      this.pending.clear();
      const worker = this.worker;
      if (worker) {
        const stopped = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
        worker.postMessage({ type: 'control', state: 'disposed' });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          stopped,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 1000);
          }),
        ]);
        if (timeout) clearTimeout(timeout);
        this.life.abort();
        await worker.terminate();
      } else this.life.abort();
      await this.cache?.release();
    })();
    return this.closing;
  }
}

/** The manager owns all workers, view leases and transient record metadata. */
export class ViewerManager {
  readonly epoch = randomUUID();
  private files = new Map<string, Promise<IndexedFile>>();
  private views = new Map<string, View>();
  private tasks = new Set<Promise<unknown>>();
  private records = 0;
  private opening = 0;
  private disposed = false;
  private lifetime = new AbortController();
  private transitions = new WeakMap<IndexedFile, Promise<void>>();
  constructor(
    readonly fs: FileSystem,
    readonly config: Config,
  ) {}
  private view(scope: WorkspaceFileScope, id: string, owner: string): View {
    const view = this.views.get(id);
    if (this.disposed || !view || view.session !== scope.sessionId || view.owner !== owner)
      throw new ViewerError('view-expired', 'Viewer expired; reopen the preview');
    return view;
  }
  async *watch(
    scope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
    owner = 'direct',
  ): AsyncIterable<ViewSnapshot> {
    if (this.disposed) throw new ViewerError('view-expired', 'Plugin unloaded');
    signal = AbortSignal.any([signal, this.lifetime.signal]);
    if (this.opening + this.views.size >= this.config.maxViews)
      throw new ViewerError('busy', 'Too many open views');
    this.opening++;
    let source: Source;
    try {
      source = await Source.open(this.fs, scope, path, signal);
    } finally {
      this.opening--;
    }
    const key = `${scope.sessionId}\0${source.identity.target}`;
    let held = this.files.get(key);
    if (!held) {
      if (this.files.size >= this.config.maxFiles)
        throw new ViewerError('busy', 'Too many indexed files; close another preview');
      held = (async () => {
        const file = new IndexedFile(source, this.config, this.epoch);
        await file.start();
        return file;
      })();
      this.files.set(key, held);
      held.catch(() => {
        if (this.files.get(key) === held) this.files.delete(key);
      });
    }
    const file = await held;
    if (file.isClosing) {
      await file.stop();
      if (this.files.get(key) === held) this.files.delete(key);
      yield* this.watch(scope, path, signal, owner);
      return;
    }
    const transition = this.transitions.get(file);
    if (transition) await transition;
    if (signal.aborted || this.views.size >= this.config.maxViews) {
      if (file.leases === 0) {
        if (this.files.get(key) === held) this.files.delete(key);
        await file.stop();
      }
      signal.throwIfAborted();
      throw new ViewerError('busy', 'Too many open views');
    }
    const id = randomUUID();
    file.leases++;
    this.views.set(id, {
      session: scope.sessionId,
      owner,
      file,
      tokens: new Map(),
      serial: 0,
      latestRequestId: 0,
    });
    let dirty = true,
      wake: (() => void) | undefined;
    const notify = () => {
      dirty = true;
      wake?.();
      wake = undefined;
    };
    const remove = file.subscribe(notify);
    signal.addEventListener('abort', notify, { once: true });
    try {
      while (!signal.aborted) {
        if (!dirty)
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (dirty || signal.aborted) resolve();
          });
        if (signal.aborted) break;
        dirty = false;
        yield {
          viewerId: id,
          epoch: this.epoch,
          generation: file.generation,
          version: file.source.identity.version,
          absolutePath: file.source.absolutePath,
          progress: { ...file.progress },
          recordLimitBytes: this.config.recordLimitMiB * 1024 * 1024,
        };
      }
    } finally {
      remove();
      signal.removeEventListener('abort', notify);
      this.views.get(id)?.task?.abort();
      this.views.get(id)?.navigation?.abort();
      this.views.delete(id);
      if (--file.leases === 0) {
        await file.stop();
        if (this.files.get(key) === held) this.files.delete(key);
        await prune(this.config).catch(() => {});
      }
    }
  }
  private async work<T>(
    view: View,
    data: object,
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<T> {
    const serial = ++view.serial;
    view.task?.abort();
    await view.pending;
    signal.throwIfAborted();
    if (serial !== view.serial) throw new DOMException('Superseded request', 'AbortError');
    if (this.records >= this.config.maxRecordTasks)
      throw new ViewerError('busy', 'Record worker limit reached');
    const controller = new AbortController();
    view.task = controller;
    const lifetime = AbortSignal.any([signal, controller.signal]);
    lifetime.throwIfAborted();
    let finished!: () => void;
    const completed = new Promise<void>((resolve) => {
      finished = resolve;
    });
    view.pending = completed;
    this.records++;
    view.file.foreground(true);
    let worker: Worker | undefined;
    const task = (async () => {
      await view.file.validate(lifetime);
      const value = await new Promise<T>((resolve, reject) => {
        worker = sourceWorker(
          new URL('./workers/record.mjs', import.meta.url),
          { ...data, start, end, limitBytes: this.config.recordLimitMiB * 1024 * 1024 },
          view.file.source,
          lifetime,
          [start, end],
        );
        const abort = () => reject(lifetime.reason);
        lifetime.addEventListener('abort', abort, { once: true });
        worker.on('message', (m: WorkerMessage) => {
          if (m.type === 'result') resolve(m.value as T);
          if (m.type === 'failure') reject(new Error(m.error));
        });
        worker.once('error', reject);
        worker.once('exit', () => {
          lifetime.removeEventListener('abort', abort);
          reject(new Error('Record worker exited'));
        });
      });
      await view.file.validate(lifetime);
      return value;
    })();
    this.tasks.add(task);
    try {
      return await task;
    } finally {
      controller.abort();
      await worker?.terminate();
      this.tasks.delete(task);
      this.records--;
      view.file.foreground(false);
      if (view.task === controller) view.task = undefined;
      if (view.pending === completed) view.pending = undefined;
      finished();
    }
  }
  async record(
    scope: WorkspaceFileScope,
    id: string,
    generation: number,
    line: number,
    requestId: number,
    signal: AbortSignal,
    owner = 'direct',
  ): Promise<RecordResult> {
    const view = this.view(scope, id, owner);
    if (generation !== view.file.generation)
      throw new ViewerError('source-changed', 'Index generation changed');
    if (!Number.isSafeInteger(requestId) || requestId < 1)
      throw new ViewerError('limit-exceeded', 'Invalid request sequence');
    if (requestId < view.latestRequestId)
      throw new DOMException('Superseded request', 'AbortError');
    view.latestRequestId = requestId;
    view.navigation?.abort();
    view.task?.abort();
    const navigation = new AbortController();
    view.navigation = navigation;
    signal = AbortSignal.any([signal, navigation.signal]);
    const [start, end] = await view.file.range(line, signal);
    if (requestId !== view.latestRequestId)
      throw new DOMException('Superseded request', 'AbortError');
    const record = await this.work<NormalRecord | LargePage>(
      view,
      { task: 'record', firstLine: line === 1 },
      start,
      end,
      signal,
    );
    signal.throwIfAborted();
    if (requestId !== view.latestRequestId)
      throw new DOMException('Superseded request', 'AbortError');
    if (generation !== view.file.generation)
      throw new ViewerError('source-changed', 'Index generation changed');
    const token = randomUUID(),
      nodes = new Map<string, LargeNode>();
    nodes.set('raw', { id: 'raw', key: '$', kind: 'string', start, end, preview: '' });
    if (record.mode === 'large') {
      nodes.set(record.root.id, record.root);
      for (const node of record.children) nodes.set(node.id, node);
    }
    view.tokens.clear();
    view.tokens.set(token, { generation, start, end, nodes });
    return { requestId, generation, line, token, bytes: end - start, record };
  }
  private token(
    scope: WorkspaceFileScope,
    id: string,
    token: string,
    owner: string,
  ): [View, RecordToken] {
    const view = this.view(scope, id, owner),
      record = view.tokens.get(token);
    if (!record || record.generation !== view.file.generation)
      throw new ViewerError('stale-record', 'Record expired');
    return [view, record];
  }
  async page(
    scope: WorkspaceFileScope,
    id: string,
    token: string,
    nodeId: string,
    skip: number,
    signal: AbortSignal,
    owner = 'direct',
  ): Promise<LargePage> {
    const [view, record] = this.token(scope, id, token, owner),
      node = record.nodes.get(nodeId);
    if (
      !node ||
      !['object', 'array'].includes(node.kind) ||
      !Number.isSafeInteger(skip) ||
      skip < 0
    )
      throw new ViewerError('stale-record', 'Unknown container');
    const page = await this.work<LargePage>(
      view,
      { task: 'page', skip },
      node.start,
      node.end,
      signal,
    );
    for (const item of page.children) {
      if (record.nodes.size >= 2000)
        record.nodes.delete(
          Array.from(record.nodes.keys()).find((k) => k !== 'raw' && k !== nodeId)!,
        );
      record.nodes.set(item.id, item);
    }
    return page;
  }
  async window(
    scope: WorkspaceFileScope,
    id: string,
    token: string,
    nodeId: string,
    offset: number,
    signal: AbortSignal,
    owner = 'direct',
  ): Promise<TextWindow> {
    const [view, record] = this.token(scope, id, token, owner),
      node = record.nodes.get(nodeId);
    if (!node || !Number.isSafeInteger(offset) || offset < 0)
      throw new ViewerError('stale-record', 'Unknown text window');
    return this.work<TextWindow>(view, { task: 'window', offset }, node.start, node.end, signal);
  }
  control(
    scope: WorkspaceFileScope,
    id: string,
    generation: number,
    action: IndexAction,
    owner = 'direct',
  ): void {
    const view = this.view(scope, id, owner);
    if (generation !== view.file.generation)
      throw new ViewerError('source-changed', 'Index generation changed');
    view.file.control(action);
  }
  async rebuild(
    scope: WorkspaceFileScope,
    id: string,
    generation: number,
    signal: AbortSignal,
    owner = 'direct',
  ): Promise<boolean> {
    const view = this.view(scope, id, owner);
    if (generation !== view.file.generation)
      throw new ViewerError('source-changed', 'Index generation changed');
    if (this.transitions.has(view.file)) throw new ViewerError('busy', 'Rebuild already running');
    for (const other of this.views.values())
      if (other.file === view.file) {
        other.task?.abort();
        other.navigation?.abort();
        other.tokens.clear();
      }
    const rebuilding = view.file.rebuild(this.fs, signal);
    this.transitions.set(view.file, rebuilding);
    try {
      await rebuilding;
      return true;
    } finally {
      this.transitions.delete(view.file);
    }
  }
  async exportChunk(
    scope: WorkspaceFileScope,
    id: string,
    token: string,
    offset: number,
    length: number,
    signal: AbortSignal,
    owner = 'direct',
  ): Promise<ExportChunk> {
    const [view, record] = this.token(scope, id, token, owner);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > record.end - record.start ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 65536
    )
      throw new ViewerError('limit-exceeded', 'Export chunk must be at most 64 KiB');
    await view.file.validate(signal);
    const end = Math.min(record.end, record.start + offset + length);
    const data = new Uint8Array(
      await view.file.source.read(record.start + offset, end - record.start - offset, signal),
    );
    await view.file.validate(signal);
    return { offset, data, eof: record.start + offset + data.length === record.end };
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.lifetime.abort();
    for (const view of this.views.values()) {
      view.task?.abort();
      view.navigation?.abort();
    }
    await Promise.allSettled([...this.files.values()].map(async (file) => (await file).stop()));
    await Promise.allSettled(this.tasks);
    await Promise.allSettled([...this.views.values()].map((view) => view.pending));
    this.views.clear();
    this.files.clear();
  }
}
