/** Publish only the isolated scoped artifact; verify immutable versions and repository metadata. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const name = '@liaojianjin/dsh-large-jsonl-viewer';
const repository = 'liaojianjin/dsh-large-jsonl-viewer';
const registry = 'https://npm.pkg.github.com';
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publish from GitHub Actions only');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
const source = JSON.parse(
  await readFile('packages/plugins/large-jsonl-viewer/package.json', 'utf8'),
);
const archive = resolve(
  `artifacts/github-packages/liaojianjin-dsh-large-jsonl-viewer-${source.version}.tgz`,
);
const manifestResult = spawnSync('tar', ['-xOf', archive, 'package/package.json'], {
  encoding: 'utf8',
});
assert.equal(manifestResult.status, 0, 'Archive manifest is readable');
const manifest = JSON.parse(manifestResult.stdout);
assert.equal(manifest.name, name);
assert.equal(manifest.version, source.version);
assert.equal(manifest.publishConfig.registry, registry);
assert.equal(manifest.repository.url, `git+https://github.com/${repository}.git`);
const integrity =
  'sha512-' +
  createHash('sha512')
    .update(await readFile(archive))
    .digest('base64');
function metadata() {
  const result = spawnSync(
    'npm',
    ['view', `${name}@${source.version}`, '--json', '--registry', registry],
    { encoding: 'utf8' },
  );
  if (result.status === 0) {
    const value = JSON.parse(result.stdout);
    return Array.isArray(value) ? value[0] : value;
  }
  if (/\bE404\b/.test(result.stderr)) return undefined;
  throw new Error(`Registry lookup failed: ${result.stderr}`);
}
const existing = metadata();
if (existing) {
  assert.equal(
    existing.dist.integrity,
    integrity,
    'Version already exists with different bytes; bump the version instead of overwriting',
  );
  console.log(`${name}@${source.version} already published with identical integrity`);
} else {
  const result = spawnSync(
    'npm',
    ['publish', archive, '--ignore-scripts', '--access', 'public', '--registry', registry],
    { stdio: 'inherit' },
  );
  assert.equal(result.status, 0, 'GitHub registry publication succeeded');
}
const published = metadata();
assert.equal(published?.name, name);
assert.equal(published.version, source.version);
assert.equal(published.dist.integrity, integrity, 'Published artifact integrity matches');
assert.equal(
  published.repository.url,
  manifest.repository.url,
  'Published package names this repository',
);
console.log(`Verified ${name}@${source.version} on ${registry}, linked to ${repository}`);
