/** Reproducible Host/worker benchmark; never claims browser rendering timings. */
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { mkdir, open, rm, writeFile, stat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { platform, arch, totalmem, cpus } from 'node:os';
import LargeJsonl from '../packages/plugins/large-jsonl-viewer/lib/index.js';
const args = process.argv.slice(2),
  value = (name: string, fallback: number) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : Number(args[i + 1]);
  };
const sizeMiB = value('--sizeMiB', 64),
  longMiB = value('--longMiB', 0),
  switches = value('--switches', 30);
if (
  !Number.isSafeInteger(sizeMiB) ||
  sizeMiB < 1 ||
  sizeMiB > 10240 ||
  !Number.isSafeInteger(longMiB) ||
  longMiB < 0 ||
  longMiB > 256 ||
  !Number.isSafeInteger(switches) ||
  switches < 1 ||
  switches > 2000
)
  throw new Error('Invalid benchmark limits');
const root = resolve('benchmark-results'),
  directory = join(root, `run-${Date.now()}`);
await mkdir(directory, { recursive: true });
const path = join(directory, 'fixture.jsonl'),
  handle = await open(path, 'wx');
try {
  if (longMiB) {
    await handle.write('{"value":"');
    const chunk = Buffer.alloc(1024 * 1024, 97);
    for (let i = 0; i < longMiB; i++) await handle.write(chunk);
    await handle.write('","items":[1,2,3]}\n');
  } else {
    const line = Buffer.from(
      '{"n":9007199254740993,"中":"😀","payload":"' + 'x'.repeat(100 * 1024) + '"}\n',
    );
    let written = 0;
    while (written < sizeMiB * 1024 * 1024) {
      await handle.write(line);
      written += line.length;
    }
  }
} finally {
  await handle.close();
}
const ctx = new Context();
const fiber = await ctx.plugin(LocalFileSystem, { cwd: directory });
const service = new LargeJsonl(ctx, { cacheDirectory: join(directory, 'cache') });
const scope = { sessionId: SessionId('benchmark'), workspaceRoot: directory },
  abort = new AbortController();
let peakRss = process.memoryUsage().rss;
const timer = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 10);
try {
  const target = await ctx.fs.resolve(path),
    bytes = (await stat(path)).size;
  const baseline = async () => {
    const start = performance.now();
    for (let offset = 0; offset < bytes; offset += 4 * 1024 * 1024)
      await ctx.fs.readByteRange(
        target,
        { offset, length: Math.min(4 * 1024 * 1024, bytes - offset) },
        abort.signal,
      );
    return performance.now() - start;
  };
  const readBeforeMs = await baseline(),
    start = performance.now(),
    stream = service.watch(scope, path, abort.signal);
  let firstRecordMs: number | undefined, first100Ms: number | undefined, view;
  for await (const snapshot of { [Symbol.asyncIterator]: () => stream }) {
    view = snapshot;
    if (firstRecordMs === undefined && snapshot.progress.lines >= 1)
      firstRecordMs = performance.now() - start;
    if (first100Ms === undefined && snapshot.progress.lines >= 100)
      first100Ms = performance.now() - start;
    if (snapshot.progress.state === 'complete') break;
    if (['error', 'changed'].includes(snapshot.progress.state))
      throw new Error(snapshot.progress.error);
  }
  // Reopen after index completion so the benchmark also exercises disk restoration.
  const indexMs = performance.now() - start,
    follow = service.watch(scope, path, abort.signal);
  view = (await follow.next()).value;
  while (view.progress.lines === 0 || view.progress.state !== 'complete')
    view = (await follow.next()).value;
  const restored = view.progress.restored,
    latencies: number[] = [],
    rssAtIntervalsMiB: { after: number; rss: number }[] = [];
  let seed = 42;
  for (let i = 0; i < switches; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const line = 1 + Math.floor((seed / 2 ** 32) * view.progress.lines),
      before = performance.now();
    const record = await service.readRecord(
      scope,
      view.viewerId,
      view.generation,
      line,
      i + 1,
      abort.signal,
    );
    if (!record.record.valid) throw new Error('Generated record failed validation');
    latencies.push(performance.now() - before);
    if ((i + 1) % 100 === 0)
      rssAtIntervalsMiB.push({ after: i + 1, rss: process.memoryUsage().rss / 1048576 });
  }
  const readAfterMs = await baseline();
  latencies.sort((a, b) => a - b);
  const report = {
    artifactSha256: Object.fromEntries(
      await Promise.all(
        ['index.js', 'workers/index.mjs', 'workers/record.mjs'].map(async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(resolve('packages/plugins/large-jsonl-viewer/lib', file)))
            .digest('hex'),
        ]),
      ),
    ),
    date: new Date().toISOString(),
    platform: platform(),
    arch: arch(),
    node: process.version,
    cpu: cpus()[0]?.model,
    totalMemory: totalmem(),
    bytes,
    longMiB,
    switches,
    lines: view.progress.lines,
    readBeforeMs,
    readAfterMs,
    indexMs,
    firstRecordMs,
    first100Ms,
    throughputRatio: readAfterMs / indexMs,
    recordP50Ms: latencies[Math.floor(latencies.length * 0.5)],
    recordP95Ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))],
    peakHostAndWorkersRssMiB: peakRss / 1048576,
    restored,
    rssAtIntervalsMiB,
    cache: 'uncontrolled OS cache; warm reads; no browser timings',
  };
  await writeFile(
    join(root, `${longMiB ? `large-${longMiB}` : `${sizeMiB}MiB`}-${switches}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  abort.abort();
  await follow.return(undefined);
} finally {
  clearInterval(timer);
  abort.abort();
  await ctx.fiber.dispose();
  await rm(directory, { recursive: true, force: true });
}
