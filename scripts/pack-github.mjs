/** Build the GitHub registry variant in a disposable workspace; never rename the npm source. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const relativePackage = 'packages/plugins/large-jsonl-viewer';
const source = join(root, relativePackage);
const name = '@liaojianjin/dsh-large-jsonl-viewer';
const registry = 'https://npm.pkg.github.com';
const output = resolve(process.argv[2] ?? 'artifacts/github-packages');
const originalManifest = await readFile(join(source, 'package.json'), 'utf8');
const originalPatch = await readFile(join(source, 'cordis.patch.yml'), 'utf8');
const manifest = JSON.parse(originalManifest);
assert.equal(manifest.name, 'dsh-large-jsonl-viewer');
assert.equal(manifest.publishConfig.registry, undefined);
const stage = await mkdtemp(join(tmpdir(), 'dsh-jsonl-github-'));
function run(args, cwd = stage) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Build/check exited ${result.status ?? result.signal}`);
}
try {
  await mkdir(join(stage, relativePackage), { recursive: true });
  for (const file of [
    'package.json',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'tsconfig.host.json',
    'tsconfig.client.json',
    'README.md',
    'README_ZH.md',
    'docs',
    'tests',
  ]) {
    await cp(join(root, file), join(stage, file), { recursive: true });
  }
  await mkdir(join(stage, 'scripts'));
  for (const file of ['build.mjs', 'pack.mjs'])
    await cp(join(root, 'scripts', file), join(stage, 'scripts', file));
  for (const file of [
    'src',
    'locale',
    'screenshots',
    'screenshots.json',
    'icon.svg',
    'LICENSE',
    'THIRD_PARTY_NOTICES',
    'tsconfig.json',
    'tsconfig.host.json',
    'tsconfig.client.json',
  ]) {
    await cp(join(source, file), join(stage, relativePackage, file), { recursive: true });
  }
  await symlink(join(root, 'node_modules'), join(stage, 'node_modules'), 'junction');
  const scoped = { ...manifest, name, publishConfig: { ...manifest.publishConfig, registry } };
  await writeFile(
    join(stage, relativePackage, 'package.json'),
    JSON.stringify(scoped, null, 2) + '\n',
  );
  await writeFile(
    join(stage, relativePackage, 'cordis.patch.yml'),
    originalPatch.replace('name: dsh-large-jsonl-viewer', `name: '${name}'`),
  );
  for (const file of ['tsconfig.host.json', 'tsconfig.client.json']) {
    const path = join(stage, relativePackage, file);
    const config = JSON.parse(await readFile(path, 'utf8'));
    config.compilerOptions.paths = { [`${name}/types`]: ['./src/types.ts'] };
    await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  }
  run(['scripts/build.mjs']);
  for (const folder of ['tests', 'tests/integration']) {
    const files = (await readdir(join(stage, folder)))
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => join(folder, file));
    run(['--import', 'tsx', '--test', ...files]);
  }
  run(['scripts/pack.mjs', output]);
  const tarball = join(output, `liaojianjin-dsh-large-jsonl-viewer-${manifest.version}.tgz`);
  run([join(root, 'scripts/package-test.mjs'), tarball, name], root);
  console.log(`GitHub Packages artifact verified: ${tarball}`);
} finally {
  await rm(stage, { recursive: true, force: true });
  assert.equal(await readFile(join(source, 'package.json'), 'utf8'), originalManifest);
  assert.equal(await readFile(join(source, 'cordis.patch.yml'), 'utf8'), originalPatch);
}
