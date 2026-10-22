/** Independent Host → Typert → Client build; no neighboring checkout imports. */
import { build } from 'esbuild';
import {
  WorkspaceTypertGenerator,
  writeWorkspaceArtifacts,
} from '@deepseek-ai/dsh-typert-generator';
import { mkdir, readFile, writeFile, cp, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd(),
  pkg = path.join(root, 'packages/plugins/large-jsonl-viewer');
const { name: packageName } = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf8'));
const tsc = (...args) => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
// The pinned analyzer recognizes decorator symbols only in registered packages.
// Mirror the installed declarations verbatim; this directory is build input,
// never a runtime dependency or a maintained fork of the protocol.
const protocol = path.dirname(
  fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-typert-protocol/package.json')),
);
const mirror = path.join(root, 'packages/build-input/typert-protocol');
await mkdir(mirror, { recursive: true });
await cp(path.join(protocol, 'lib/types'), path.join(mirror, 'declarations'), { recursive: true });
try {
  await symlink(path.resolve(protocol, '../..'), path.join(mirror, 'node_modules'));
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
await writeFile(
  path.join(mirror, 'declarations/public.d.ts'),
  `export {Remote, RemoteError, TypertRemoteService} from './index.ts';\nexport type {TypertLookup, TypertContext, RemoteStream, TypertClientRemote, TypertRemoteNamespaceMap, TypertRemoteMap, TypertRemoteScopeMap, RemoteResult, RemoteErrorDetailsMap, RemoteFailure, RemoteDecoded, RemoteStreamHandle, TypertRemoteInfo, TypertRemoteMethod, TypertRemoteContribution} from './index.ts';\n`,
);
await writeFile(
  path.join(mirror, 'declarations/types-public.d.ts'),
  `export type {TypertLookup, TypertContext, RemoteStream, TypertClientRemote, TypertRemoteNamespaceMap, TypertRemoteMap, TypertRemoteScopeMap, RemoteResult, RemoteErrorDetailsMap, RemoteFailure, RemoteDecoded, RemoteStreamHandle, TypertRemoteInfo, TypertRemoteMethod, TypertRemoteContribution} from './types.ts';\n`,
);
await writeFile(
  path.join(mirror, 'package.json'),
  JSON.stringify({
    name: '@deepseek-ai/dsh-typert-protocol',
    type: 'module',
    exports: { '.': './declarations/public.d.ts', './types': './declarations/types-public.d.ts' },
  }),
);
await writeFile(
  path.join(mirror, 'tsconfig.json'),
  JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: { noEmit: true, composite: false },
    include: ['declarations/**/*.d.ts'],
  }),
);
const sessionDir = path.dirname(
  fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-session/package.json')),
);
const sessionMirror = path.join(root, 'packages/build-input/session');
await mkdir(sessionMirror, { recursive: true });
await cp(path.join(sessionDir, 'lib/types'), path.join(sessionMirror, 'declarations'), {
  recursive: true,
});
try {
  await symlink(path.resolve(sessionDir, '../..'), path.join(sessionMirror, 'node_modules'));
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
await writeFile(
  path.join(sessionMirror, 'declarations/public.d.ts'),
  `export type {SessionId} from './types.ts';\n`,
);
await writeFile(
  path.join(sessionMirror, 'package.json'),
  JSON.stringify({
    name: '@deepseek-ai/dsh-session',
    type: 'module',
    exports: { './types': './declarations/public.d.ts' },
  }),
);
await writeFile(
  path.join(sessionMirror, 'tsconfig.json'),
  JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: { noEmit: true, composite: false },
    include: ['declarations/**/*.d.ts'],
  }),
);
const fileDir = path.dirname(
  fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-workspace-files/package.json')),
);
const fileMirror = path.join(root, 'packages/build-input/workspace-files');
await mkdir(path.join(fileMirror, 'declarations'), { recursive: true });
const fileDeclaration = await readFile(path.join(fileDir, 'lib/types/index.d.ts'), 'utf8');
const scopeDeclaration = fileDeclaration.match(
  /export interface WorkspaceFileScope \{[\s\S]*?\n\}/,
)?.[0];
const lookupDeclaration = fileDeclaration.match(
  /declare module '@deepseek-ai\/dsh-typert-protocol' \{[\s\S]*?\n\}/,
)?.[0];
if (!scopeDeclaration || !lookupDeclaration)
  throw new Error('Pinned WorkspaceFileScope declarations changed');
await writeFile(
  path.join(fileMirror, 'declarations/index.d.ts'),
  `import type {SessionId} from '@deepseek-ai/dsh-session/types';\nimport type {TypertLookup} from '@deepseek-ai/dsh-typert-protocol';\n${scopeDeclaration}\n${lookupDeclaration}\n`,
);
await writeFile(
  path.join(fileMirror, 'package.json'),
  JSON.stringify({
    name: '@deepseek-ai/dsh-api-workspace-files',
    type: 'module',
    exports: { '.': './declarations/index.d.ts' },
  }),
);
await writeFile(
  path.join(fileMirror, 'tsconfig.json'),
  JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: { noEmit: true, composite: false },
    include: ['declarations/**/*.d.ts'],
  }),
);
await mkdir(path.join(pkg, 'lib'), { recursive: true });
tsc('-p', path.join(pkg, 'tsconfig.host.json'));
await build({
  entryPoints: [path.join(pkg, 'src/index.ts')],
  outfile: path.join(pkg, 'lib/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*'],
});
const artifacts = new WorkspaceTypertGenerator(root).generate([packageName], ['host']);
if (!artifacts.length || !artifacts.some((a) => a.remote))
  throw new Error('No strict Remote artifacts generated');
writeWorkspaceArtifacts(root, artifacts);
await build({
  entryPoints: {
    index: path.join(pkg, 'src/workers/index.ts'),
    record: path.join(pkg, 'src/workers/record.ts'),
  },
  outdir: path.join(pkg, 'lib/workers'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'esm',
  target: 'node22',
});
const workerBuild = await build({
  entryPoints: [path.join(root, 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  minify: true,
});
const workerSource = workerBuild.outputFiles[0].text;
tsc('-p', path.join(pkg, 'tsconfig.client.json'));
const client = await build({
  entryPoints: [path.join(pkg, 'src/client/index.ts')],
  bundle: true,
  platform: 'browser',
  jsx: 'automatic',
  minify: true,
  format: 'cjs',
  target: 'es2022',
  outfile: path.join(pkg, 'lib/client.js'),
  write: false,
  plugins: [
    {
      name: 'inline-monaco-worker',
      setup(build) {
        build.onResolve({ filter: /^monaco-worker-source$/ }, () => ({
          path: 'worker',
          namespace: 'inline-worker',
        }));
        build.onLoad({ filter: /.*/, namespace: 'inline-worker' }, () => ({
          contents: workerSource,
          loader: 'text',
        }));
      },
    },
  ],
  external: ['react', 'react-dom', 'zod', '@deepseek-ai/cordis'],
  // editor.api omits the icon font; Monaco's package exports only resolve JS modules.
  alias: {
    'monaco-codicons.css': path.join(
      root,
      'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css',
    ),
  },
  loader: { '.ttf': 'dataurl' },
});
const js = client.outputFiles.find((f) => f.path.endsWith('.js')) ?? client.outputFiles[0];
await writeFile(
  path.join(pkg, 'lib/client.js'),
  `window.__ModuleLoader__.load({id:${JSON.stringify(packageName)},factory(require){const module={exports:{}};(function(module,exports){\n${js.text}\n})(module,module.exports);const apply=module.exports.apply;const stylesheet=${JSON.stringify(client.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '')};const result={...module.exports,apply(ctx){ctx.effect(()=>{const style=document.createElement('style');style.textContent=stylesheet;document.head.appendChild(style);return()=>style.remove();});return apply(ctx);}};return result;}});\n`,
);
await mkdir(path.join(pkg, 'lib/licenses'), { recursive: true });
for (const [module, file] of [
  ['monaco-editor', 'LICENSE'],
  ['monaco-editor', 'ThirdPartyNotices.txt'],
  ['jsonc-parser', 'LICENSE.md'],
])
  await cp(
    path.join(root, 'node_modules', module, file),
    path.join(pkg, 'lib/licenses', module + '-' + file),
  );
console.log('Built Host, generated strict Remote, and built Client factory');
