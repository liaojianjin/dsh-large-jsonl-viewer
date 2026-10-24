/** Add a version-free Release asset by copying the already published, verified archive. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'liaojianjin/dsh-large-jsonl-viewer';
export const ALIAS = 'dsh-large-jsonl-viewer.tgz';

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${binary} failed: ${result.stderr}`);
  return result.stdout;
}

export async function publishReleaseAlias({ tag, gh = (args) => command('gh', args) }) {
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'A stable vX.Y.Z Release tag is required');
  const version = tag.slice(1),
    filename = `dsh-large-jsonl-viewer-${version}.tgz`,
    release = JSON.parse(gh(['api', `repos/${REPOSITORY}/releases/tags/${tag}`]));
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false, 'Publish the Release before creating its alias');
  assert.equal(release.prerelease, false, 'Prereleases do not receive the latest-Release alias');
  for (const name of [filename, 'SHA256SUMS.txt'])
    assert.ok(
      release.assets.some((asset) => asset.name === name && asset.state === 'uploaded'),
      `Release must already contain ${name}`,
    );

  const directory = await mkdtemp(join(tmpdir(), 'dsh-jsonl-release-alias-'));
  try {
    gh([
      'release',
      'download',
      tag,
      '--repo',
      REPOSITORY,
      '--dir',
      directory,
      '--pattern',
      filename,
      '--pattern',
      'SHA256SUMS.txt',
    ]);
    const original = await readFile(join(directory, filename)),
      sha256 = createHash('sha256').update(original).digest('hex'),
      sums = (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8'))
        .split(/\r?\n/)
        .map((line) => line.match(/^([a-f\d]{64})[ \t]+\*?(.+)$/i))
        .filter((match) => match?.[2] === filename);
    assert.equal(sums.length, 1, 'Exactly one checksum must name the versioned archive');
    assert.equal(sha256, sums[0][1].toLowerCase(), 'Published archive checksum must match');
    const manifest = JSON.parse(
      command('tar', ['-xOf', join(directory, filename), 'package/package.json']),
    );
    assert.equal(manifest.name, 'dsh-large-jsonl-viewer');
    assert.equal(manifest.version, version, 'Release tag must match the archived package version');
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');

    const existing = release.assets.find((asset) => asset.name === ALIAS);
    let created = false;
    if (existing) {
      assert.equal(
        existing.state,
        'uploaded',
        'Existing alias is not ready; retry after its upload',
      );
      gh([
        'release',
        'download',
        tag,
        '--repo',
        REPOSITORY,
        '--dir',
        directory,
        '--pattern',
        ALIAS,
      ]);
      assert.ok(
        original.equals(await readFile(join(directory, ALIAS))),
        'Existing alias differs from the verified archive; never overwrite Release assets',
      );
    } else {
      assert.notEqual(
        release.immutable,
        true,
        'This Release is immutable; its assets cannot be extended',
      );
      await copyFile(join(directory, filename), join(directory, ALIAS));
      // No --clobber: even a concurrent upload cannot overwrite a previously published asset.
      gh(['release', 'upload', tag, join(directory, ALIAS), '--repo', REPOSITORY]);
      created = true;
      await rm(join(directory, ALIAS));
      gh([
        'release',
        'download',
        tag,
        '--repo',
        REPOSITORY,
        '--dir',
        directory,
        '--pattern',
        ALIAS,
      ]);
      assert.ok(
        original.equals(await readFile(join(directory, ALIAS))),
        'Uploaded alias must preserve the exact archive bytes',
      );
    }
    return { tag, filename: ALIAS, sha256, created };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publish Release aliases from GitHub Actions');
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY);
  const result = await publishReleaseAlias({ tag: process.env.RELEASE_TAG });
  console.log(
    `${result.created ? 'Created' : 'Verified existing'} ${result.tag}/${result.filename}; SHA-256 ${result.sha256}`,
  );
}
