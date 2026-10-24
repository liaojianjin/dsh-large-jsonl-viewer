/** Exercise the publisher against a local fake GitHub CLI; no credentials or network calls. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { publishReleaseAlias, ALIAS } from '../scripts/publish-release-alias.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-alias-fixture-'));
  try {
    await mkdir(join(root, 'package'));
    await writeFile(
      join(root, 'package/package.json'),
      JSON.stringify({
        name: 'dsh-large-jsonl-viewer',
        version: '0.1.4',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    const archive = join(root, 'archive.tgz');
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'package']).status, 0);
    const original = await readFile(archive),
      filename = 'dsh-large-jsonl-viewer-0.1.4.tgz';
    const state = {
      release: {
        tag_name: 'v0.1.4',
        draft: false,
        prerelease: false,
        assets: [
          { name: filename, state: 'uploaded' },
          { name: 'SHA256SUMS.txt', state: 'uploaded' },
        ],
      },
      filename,
      sums: createHash('sha256').update(original).digest('hex') + '  ' + filename + '\n',
      alias: undefined,
      uploads: 0,
    };
    const gh = (args) => {
      assert.equal(args.includes('--clobber'), false);
      if (args[0] === 'api') return JSON.stringify(state.release);
      if (args[1] === 'download') {
        const directory = args[args.indexOf('--dir') + 1];
        for (let i = 0; i < args.length; i++)
          if (args[i] === '--pattern') {
            const name = args[++i];
            writeFileSync(
              join(directory, name),
              name === state.filename ? original : name === ALIAS ? state.alias : state.sums,
            );
          }
        return '';
      }
      assert.equal(args[1], 'upload');
      state.uploads++;
      state.alias = readFileSync(args[3]);
      state.release.assets.push({ name: ALIAS, state: 'uploaded' });
      return '';
    };
    await run({ state, gh, original });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('alias preserves the versioned bytes, verifies upload, and reruns without another upload', async () => {
  await fixture(async ({ state, gh, original }) => {
    const first = await publishReleaseAlias({ tag: 'v0.1.4', gh });
    assert.equal(first.created, true);
    assert.ok(state.alias.equals(original));
    assert.equal((await publishReleaseAlias({ tag: 'v0.1.4', gh })).created, false);
    assert.equal(state.uploads, 1);
  });
});

test('a mismatched existing alias is refused without replacing it', async () => {
  await fixture(async ({ state, gh }) => {
    state.alias = Buffer.from('different archive');
    state.release.assets.push({ name: ALIAS, state: 'uploaded' });
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.4', gh }), /never overwrite/);
    assert.equal(state.uploads, 0);
    assert.equal(state.alias.toString(), 'different archive');
  });
});

test('corrupt checksums, incorrect package identity, and missing original assets cannot be uploaded', async () => {
  await fixture(async ({ state, gh }) => {
    const correct = state.sums;
    state.sums = '0'.repeat(64) + '  dsh-large-jsonl-viewer-0.1.4.tgz\n';
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.4', gh }), /checksum must match/);
    state.filename = 'dsh-large-jsonl-viewer-0.1.5.tgz';
    state.release.tag_name = 'v0.1.5';
    state.release.assets[0].name = state.filename;
    state.sums = correct.replace('0.1.4.tgz', '0.1.5.tgz');
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.5', gh }), /Release tag must match/);
    state.release.assets.shift();
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.5', gh }), /must already contain/);
    assert.equal(state.uploads, 0);
  });
});

test('drafts, prereleases, immutable releases, and unsafe tags are refused', async () => {
  await fixture(async ({ state, gh }) => {
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.4; shell', gh }), /stable vX.Y.Z/);
    state.release.prerelease = true;
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.4', gh }), /Prereleases/);
    state.release.prerelease = false;
    state.release.draft = true;
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.4', gh }), /Publish the Release/);
    state.release.draft = false;
    state.release.immutable = true;
    await assert.rejects(publishReleaseAlias({ tag: 'v0.1.4', gh }), /immutable/);
    assert.equal(state.uploads, 0);
  });
});
