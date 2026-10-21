/** Single-writer disk caches; contention falls back to isolated temporary space. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import { sameIdentity, type Identity } from '../core/io/reader.ts';
export interface CacheLease {
  directory: string;
  warning?: string;
  release(): Promise<void>;
}
export async function acquireCache(config: Config, key: string): Promise<CacheLease> {
  const directory = join(config.cacheDirectory, createHash('sha256').update(key).digest('hex'));
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(join(directory, '.lock'));
  } catch {
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-jsonl-'));
    return {
      directory: temporary,
      warning: 'Temporary index cache (cache unavailable or in use)',
      release: () => rm(temporary, { recursive: true, force: true }),
    };
  }
  return {
    directory,
    release: () => rm(join(directory, '.lock'), { recursive: true, force: true }),
  };
}

/** Remove abandoned generations while holding the exclusive writer lease. */
export async function prepareCache(
  directory: string,
  source: Identity,
  reset: boolean,
): Promise<void> {
  const keep = new Set<string>();
  let reusable = false;
  try {
    const manifest = join(directory, 'manifest.json');
    if (!reset && (await stat(manifest)).size <= 16 * 1024 * 1024) {
      const value = JSON.parse(await readFile(manifest, 'utf8'));
      if (value.version === 1 && sameIdentity(value.source, source) && Array.isArray(value.pages)) {
        for (const page of value.pages) {
          if (typeof page.file === 'string' && /^page-[a-f0-9-]+\.bin$/.test(page.file))
            keep.add(page.file);
        }
        reusable = true;
      }
    }
  } catch (error) {
    // Missing or malformed manifests have no reusable pages; the scanner starts at byte zero.
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  for (const name of await readdir(directory)) {
    if (
      (/^page-[a-f0-9-]+\.bin$/.test(name) && !keep.has(name)) ||
      /^manifest-.*\.tmp$/.test(name)
    ) {
      await rm(join(directory, name), { force: true });
    }
  }
  if (!reusable) await rm(join(directory, 'manifest.json'), { force: true });
}
export async function prune(config: Config): Promise<void> {
  const entries: { path: string; bytes: number; time: number }[] = [];
  const dirs = await readdir(config.cacheDirectory, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory() || !/^[a-f0-9]{64}$/.test(dir.name)) continue;
    const path = join(config.cacheDirectory, dir.name);
    const names: string[] = await readdir(path).catch(() => []);
    if (names.includes('.lock')) continue;
    let bytes = 0;
    for (const name of names)
      bytes += (await stat(join(path, name)).catch(() => ({ size: 0 }))).size;
    entries.push({ path, bytes, time: (await stat(path)).mtimeMs });
  }
  let bytes = entries.reduce((n, e) => n + e.bytes, 0);
  for (const entry of entries.sort((a, b) => a.time - b.time)) {
    if (bytes <= config.cacheLimitMiB * 1024 * 1024) break;
    // Claim the same lock as a writer before deletion; never evict an active cache.
    try {
      await mkdir(join(entry.path, '.lock'));
    } catch {
      continue;
    }
    await rm(entry.path, { recursive: true, force: true });
    bytes -= entry.bytes;
  }
}
