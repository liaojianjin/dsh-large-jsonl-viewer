/** Host plugin: no model tools, prompt sections, or session events. */
import type { Context } from '@deepseek-ai/cordis';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files';
import type {} from '@deepseek-ai/dsh-fs';
import { resolveConfig, type Config } from './config.ts';
import { ViewerManager, ViewerError } from './host/manager.ts';
import type {
  ExportChunk,
  IndexAction,
  LargePage,
  RecordResult,
  TextWindow,
  ViewSnapshot,
} from './types.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'large-jsonl/source-changed': { reason: string };
    'large-jsonl/view-expired': { reason: string };
    'large-jsonl/stale-record': { reason: string };
    'large-jsonl/line-not-ready': { reason: string };
    'large-jsonl/line-out-of-range': { reason: string };
    'large-jsonl/busy': { reason: string };
    'large-jsonl/limit-exceeded': { reason: string };
    'large-jsonl/read-failed': { reason: string };
  }
}
function failure(error: unknown): never {
  if (error instanceof ViewerError)
    throw new RemoteError(`large-jsonl/${error.code}`, error.message, { reason: error.message });
  if (error instanceof Error && error.name === 'AbortError') throw error;
  throw new RemoteError('large-jsonl/read-failed', 'File operation failed', {
    reason: error instanceof Error ? error.message : String(error),
  });
}
/** Session-authorized indexed file preview service. */
export class LargeJsonl extends TypertRemoteService {
  static inject = ['fs', 'workspaceFiles', 'typert'];
  private readonly manager: ViewerManager;
  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'largeJsonl');
    this.manager = new ViewerManager(ctx.fs, resolveConfig(config));
    ctx.effect(() => () => this.manager.dispose());
  }
  private get owner(): string {
    return this.ctx.invocation?.peer.id ?? 'direct';
  }
  /** Hold an independently cancellable view and follow coalesced index snapshots. */
  @Remote({ name: 'watch', mode: 'stream' })
  async *watch(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): AsyncIterable<ViewSnapshot> {
    try {
      yield* this.manager.watch(workspaceFileScope, path, signal, this.owner);
    } catch (error) {
      failure(error);
    }
  }
  /** Read one indexed physical line with a token for subsequent node/export requests. */
  @Remote('readRecord')
  async readRecord(
    workspaceFileScope: WorkspaceFileScope,
    viewerId: string,
    generation: number,
    line: number,
    requestId: number,
    signal: AbortSignal,
  ): Promise<RecordResult> {
    try {
      return await this.manager.record(
        workspaceFileScope,
        viewerId,
        generation,
        line,
        requestId,
        signal,
        this.owner,
      );
    } catch (error) {
      failure(error);
    }
  }
  /** Expand one published container without retaining its complete descendants. */
  @Remote('readNodePage')
  async readNodePage(
    workspaceFileScope: WorkspaceFileScope,
    viewerId: string,
    token: string,
    nodeId: string,
    skip: number,
    signal: AbortSignal,
  ): Promise<LargePage> {
    try {
      return await this.manager.page(
        workspaceFileScope,
        viewerId,
        token,
        nodeId,
        skip,
        signal,
        this.owner,
      );
    } catch (error) {
      failure(error);
    }
  }
  /** Read a UTF-8-aligned bounded text window. */
  @Remote('readWindow')
  async readWindow(
    workspaceFileScope: WorkspaceFileScope,
    viewerId: string,
    token: string,
    nodeId: string,
    offset: number,
    signal: AbortSignal,
  ): Promise<TextWindow> {
    try {
      return await this.manager.window(
        workspaceFileScope,
        viewerId,
        token,
        nodeId,
        offset,
        signal,
        this.owner,
      );
    } catch (error) {
      failure(error);
    }
  }
  /** Control the shared file index, independently from pending navigation. */
  @Remote('controlIndex')
  controlIndex(
    workspaceFileScope: WorkspaceFileScope,
    viewerId: string,
    generation: number,
    action: IndexAction,
    signal: AbortSignal,
  ): boolean {
    try {
      signal.throwIfAborted();
      this.manager.control(workspaceFileScope, viewerId, generation, action, this.owner);
      return true;
    } catch (error) {
      failure(error);
    }
  }
  /** Explicitly replace the index generation after refreshing source identity. */
  @Remote('rebuild')
  async rebuild(
    workspaceFileScope: WorkspaceFileScope,
    viewerId: string,
    generation: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      return await this.manager.rebuild(
        workspaceFileScope,
        viewerId,
        generation,
        signal,
        this.owner,
      );
    } catch (error) {
      failure(error);
    }
  }
  /** Export exact source bytes with at most 64 KiB buffered per request. */
  @Remote('readExportChunk')
  async readExportChunk(
    workspaceFileScope: WorkspaceFileScope,
    viewerId: string,
    token: string,
    offset: number,
    length: number,
    signal: AbortSignal,
  ): Promise<ExportChunk> {
    try {
      return await this.manager.exportChunk(
        workspaceFileScope,
        viewerId,
        token,
        offset,
        length,
        signal,
        this.owner,
      );
    } catch (error) {
      failure(error);
    }
  }
}
export default LargeJsonl;
