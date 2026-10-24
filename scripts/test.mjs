/** Run runtime tests with automatic JSX and no build-only declaration aliases. */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const folders = process.argv.slice(2);
if (!folders.length) folders.push('tests');
const files = (
  await Promise.all(
    folders.map(async (folder) =>
      (await readdir(folder))
        .filter((file) => file.endsWith('.test.ts'))
        .map((file) => join(folder, file)),
    ),
  )
)
  .flat()
  .sort();
if (!files.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: resolve('tsconfig.tests.json') },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
