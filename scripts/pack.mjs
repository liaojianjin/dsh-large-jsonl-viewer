/** Produce a prebuilt artifact; installation executes no build hooks. */
import { spawnSync } from 'node:child_process';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const pkg = resolve('packages/plugins/large-jsonl-viewer');
const manifest = JSON.parse(await readFile(resolve(pkg, 'package.json'), 'utf8'));
const output = resolve(process.argv[2] ?? 'artifacts');
await mkdir(output, { recursive: true });
for (const name of ['README.md', 'README_ZH.md']) {
  await writeFile(
    resolve(pkg, name),
    (await readFile(resolve(name), 'utf8'))
      .replaceAll('packages/plugins/large-jsonl-viewer/screenshots/', 'screenshots/')
      .replaceAll('packages/plugins/large-jsonl-viewer/icon.svg', 'icon.svg'),
  );
}
await cp(resolve('docs'), resolve(pkg, 'docs'), { recursive: true });
const validation = resolve(pkg, 'docs/validation.md');
await writeFile(
  validation,
  (await readFile(validation, 'utf8')).replaceAll(
    '../packages/plugins/large-jsonl-viewer/screenshots/',
    '../screenshots/',
  ),
);
const result = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output], {
  cwd: pkg,
  stdio: 'inherit',
  env: { ...process.env, npm_config_cache: resolve(output, '.npm-cache') },
});
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const name = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
  const hash = createHash('sha256')
    .update(await readFile(resolve(output, name)))
    .digest('hex');
  await writeFile(resolve(output, 'SHA256SUMS.txt'), `${hash}  ${name}\n`);
}
