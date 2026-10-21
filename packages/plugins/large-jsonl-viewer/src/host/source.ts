/** Source admission and version checks always use the composed filesystem. */
import { createHash } from 'node:crypto';
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs';
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files';
import type { Identity } from '../core/io/reader.ts';
export class SourceChanged extends Error {
  constructor() {
    super('Source file changed. Rebuild the index.');
    this.name = 'SourceChanged';
  }
}
export class Source {
  private constructor(
    readonly fs: FileSystem,
    readonly scope: WorkspaceFileScope,
    readonly path: string,
    readonly target: FsTarget,
    readonly identity: Identity,
    readonly absolutePath: string,
  ) {}
  static async open(
    fs: FileSystem,
    scope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<Source> {
    if (!path || path.includes('\0')) throw new Error('Invalid source path');
    const entry = await fs.lstat(path, { cwd: scope.workspaceRoot }, signal);
    if (!entry || entry.type !== 'file')
      throw new Error('Only regular files are supported; final symlinks are refused');
    const target = await fs.resolve(path, { cwd: scope.workspaceRoot, signal }),
      info = await fs.stat(target, signal);
    if (
      !info ||
      info.type !== 'file' ||
      info.size === undefined ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0
    )
      throw new Error('Source size is unknown or unsupported');
    const hash = createHash('sha256');
    for (const offset of [0, Math.max(0, info.size - 65536)])
      hash.update(
        await fs.readByteRange(
          target,
          { offset, length: Math.min(65536, info.size - offset) },
          signal,
        ),
      );
    const source = new Source(
      fs,
      scope,
      path,
      target,
      {
        size: info.size,
        version: info.version,
        target: target.targetKey,
        fingerprint: hash.digest('hex'),
      },
      fs.processPath(target),
    );
    await source.validate(signal);
    return source;
  }
  async validate(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const entry = await this.fs.lstat(this.path, { cwd: this.scope.workspaceRoot }, signal);
    const current = await this.fs.resolve(this.path, { cwd: this.scope.workspaceRoot, signal }),
      info = await this.fs.stat(current, signal);
    if (
      !entry ||
      entry.type !== 'file' ||
      current.targetKey !== this.target.targetKey ||
      !info ||
      info.type !== 'file' ||
      info.version !== this.identity.version ||
      info.size !== this.identity.size
    )
      throw new SourceChanged();
  }
  async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > 8 * 1024 * 1024 ||
      offset + length > this.identity.size
    )
      throw new Error('Invalid source byte range');
    return this.fs.readByteRange(this.target, { offset, length }, signal);
  }
}
