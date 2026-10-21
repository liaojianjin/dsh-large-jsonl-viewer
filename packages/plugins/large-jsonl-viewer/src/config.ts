/** Host deployment limits, validated before any source is opened. */
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
export interface Config {
  cacheDirectory: string;
  scanChunkMiB: number;
  recordLimitMiB: number;
  cacheLimitMiB: number;
  maxLines: number;
  maxFiles: number;
  maxViews: number;
  maxRecordTasks: number;
  pollMs: number;
}
export function resolveConfig(value: Partial<Config> = {}): Config {
  const config: Config = {
    cacheDirectory: join(homedir(), '.cache', 'dsh-large-jsonl-viewer'),
    scanChunkMiB: 4,
    recordLimitMiB: 8,
    cacheLimitMiB: 512,
    maxLines: 10000000,
    maxFiles: 2,
    maxViews: 32,
    maxRecordTasks: 2,
    pollMs: 2000,
    ...value,
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Config must be an object');
  for (const key of Object.keys(value))
    if (
      !Object.hasOwn(config, key) ||
      ![
        'cacheDirectory',
        'scanChunkMiB',
        'recordLimitMiB',
        'cacheLimitMiB',
        'maxLines',
        'maxFiles',
        'maxViews',
        'maxRecordTasks',
        'pollMs',
      ].includes(key)
    )
      throw new Error(`Unknown configuration field: ${key}`);
  if (!isAbsolute(config.cacheDirectory)) throw new Error('cacheDirectory must be absolute');
  const bounds: Record<Exclude<keyof Config, 'cacheDirectory'>, [number, number]> = {
    scanChunkMiB: [1, 8],
    recordLimitMiB: [1, 16],
    cacheLimitMiB: [16, 4096],
    maxLines: [1, 100000000],
    maxFiles: [1, 8],
    maxViews: [1, 128],
    maxRecordTasks: [1, 4],
    pollMs: [250, 60000],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const n = config[key as keyof typeof bounds];
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
  }
  if (![1, 4, 8].includes(config.scanChunkMiB)) throw new Error('scanChunkMiB must be 1, 4 or 8');
  return config;
}
