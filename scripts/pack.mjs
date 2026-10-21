/** Produce a prebuilt artifact; installation executes no build hooks. */
import { spawnSync } from 'node:child_process';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd(),
  pkg = resolve('packages/plugins/large-jsonl-viewer');
await mkdir(resolve('artifacts'), { recursive: true });
await writeFile(
  resolve(pkg, 'README.md'),
  (await readFile(resolve('README.md'), 'utf8')).replaceAll(
    'packages/plugins/large-jsonl-viewer/screenshots/',
    'screenshots/',
  ),
);
await cp(resolve('docs'), resolve(pkg, 'docs'), { recursive: true });
const validation = resolve(pkg, 'docs/validation.md');
await writeFile(
  validation,
  (await readFile(validation, 'utf8')).replaceAll(
    '../packages/plugins/large-jsonl-viewer/screenshots/',
    '../screenshots/',
  ),
);
const result = spawnSync(
  'npm',
  ['pack', '--ignore-scripts', '--pack-destination', resolve('artifacts')],
  {
    cwd: pkg,
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: resolve('artifacts/.npm-cache') },
  },
);
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const name = 'dsh-large-jsonl-viewer-0.1.0.tgz';
  const hash = createHash('sha256')
    .update(await readFile(resolve('artifacts', name)))
    .digest('hex');
  await writeFile(resolve('artifacts/SHA256SUMS.txt'), `${hash}  ${name}\n`);
}
