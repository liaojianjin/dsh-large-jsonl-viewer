import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToString } from 'react-dom/server';
const manifest = JSON.parse(
  await readFile(resolve('packages/plugins/large-jsonl-viewer/package.json'), 'utf8'),
);
const expectedName = process.argv[3] ?? manifest.name;
const tar = resolve(process.argv[2] ?? `artifacts/dsh-large-jsonl-viewer-${manifest.version}.tgz`),
  dir = await mkdtemp(join(tmpdir(), 'dsh-jsonl-package-'));
try {
  const result = spawnSync('tar', ['-xzf', tar, '-C', dir], { stdio: 'inherit' });
  assert.equal(result.status, 0);
  const pkg = JSON.parse(await readFile(join(dir, 'package/package.json'), 'utf8'));
  assert.equal(pkg.name, expectedName);
  assert.equal(pkg.version, manifest.version);
  assert.deepEqual(pkg.engines, manifest.engines, 'Packaged runtime requirements match the source');
  assert.deepEqual(
    pkg.peerDependencies,
    manifest.peerDependencies,
    'Packaged shared peer requirements match the source',
  );
  assert.equal(
    pkg.publishConfig.registry,
    expectedName.startsWith('@liaojianjin/') ? 'https://npm.pkg.github.com' : undefined,
  );
  const patch = await readFile(join(dir, 'package/cordis.patch.yml'), 'utf8');
  assert.ok(
    patch
      .split('\n')
      .some(
        (line) =>
          line.trim() === `name: ${expectedName}` || line.trim() === `name: '${expectedName}'`,
      ),
  );
  for (const value of Object.values(pkg.exports)) {
    const path = typeof value === 'string' ? value : value.default;
    if (!path.includes('*')) await readFile(join(dir, 'package', path));
  }
  await readFile(join(dir, 'package/docs/validation.md'));
  const icon = await readFile(join(dir, 'package', pkg.exports['./icon']));
  assert.ok(icon.length > 0 && icon.length <= 256 * 1024);
  assert.equal(pkg.publishConfig.access, 'public');
  for (const name of ['README.md', 'README_ZH.md']) {
    const markdown = await readFile(join(dir, 'package', name), 'utf8');
    for (const match of markdown.matchAll(
      /\[[^\]]*\]\((\.\/[^)]+)\)|(?:src|href)="(\.\/[^"]+)"/g,
    )) {
      await readFile(join(dir, 'package', (match[1] ?? match[2]).split('#')[0]));
    }
  }
  await readFile(join(dir, 'package/docs/preview.png'));
  const screenshots = JSON.parse(await readFile(join(dir, 'package/screenshots.json'), 'utf8'));
  for (const path of screenshots) await readFile(join(dir, 'package', path));
  for (const file of ['index', 'record'])
    await readFile(join(dir, 'package/lib/workers', file + '.mjs'));
  const browser = await readFile(join(dir, 'package/lib/client.js'), 'utf8');
  assert.match(browser, /__ModuleLoader__\.load/);
  assert.doesNotMatch(browser, /acquireVsCodeApi/);
  assert.doesNotMatch(browser, /\/Volumes\/WD_BLACK/);
  let entry;
  const styles = [];
  vm.runInNewContext(
    browser,
    {
      URL,
      Blob,
      document: {
        createElement() {
          return { remove() {} };
        },
        head: {
          appendChild(value) {
            styles.push(value);
          },
        },
      },
      window: {
        __ModuleLoader__: {
          load(value) {
            entry = value;
          },
        },
      },
    },
    { timeout: 5000 },
  );
  assert.equal(entry.id, expectedName);
  const plugin = entry.factory(createRequire(import.meta.url));
  assert.equal(typeof plugin.apply, 'function');
  let body, nativeBody;
  const effects = [];
  const ctx = {
    effect(fn) {
      const value = fn();
      effects.push(value);
      return value;
    },
    inject(_deps, fn) {
      if (_deps.includes('betterSidebar') && !ctx.betterSidebar) return;
      fn(ctx);
    },
    remote: { $mount: async () => () => {}, largeJsonl: {}, workspaceFiles: {} },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return (key) => key;
      },
    },
    documentPreviews: {
      register(value) {
        assert.equal(value.loading, 'renderer');
        return () => {};
      },
    },
    slots: {
      inject(_name, fn) {
        return fn();
      },
      register(_definition, component) {
        if (_definition.name === 'sidebar.right.tab.document') body = component;
        else nativeBody = component;
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-workspace-files'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-session'));
  const stylesheet = styles[0].textContent;
  const iconFont = await readFile(
    resolve('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf'),
  );
  assert.ok(
    /@font-face\{[^}]*font-family:["']?codicon["']?[;}]/.test(stylesheet),
    'Codicon font-face is installed with the Client stylesheet',
  );
  assert.ok(stylesheet.includes(iconFont.toString('base64')), 'Codicon font is bundled offline');
  assert.ok(
    /\.codicon\[class\*=(?:"codicon-"|'codicon-'|codicon-)\]/.test(stylesheet),
    'Codicon glyphs use their bundled icon font',
  );
  let filesOpen = false;
  const browserVisibility = {
    getExpanded: () => [],
    setExpanded() {},
    getScrollTop: () => undefined,
    setScrollTop() {},
    getSnapshot: () => filesOpen,
    subscribe: () => () => {},
    setOpen(open) {
      filesOpen = open;
    },
  };
  const props = {
    useTabInfo: () => ({
      tab: {
        id: 'package-test',
        signal: new AbortController().signal,
        navigation: { revision: 1 },
      },
    }),
    useSessions: (selector) => selector({ byId: { s: { cwd: '/workspace' } } }),
    resourceAddress: 'dsh-resource://file/session/s/demo.jsonl',
    content: { kind: 'renderer', revision: 1, loaded() {}, failed() {}, reload() {} },
    wrap: true,
    t: (key) => key,
    api: {},
    files: { list: async () => ({ ok: true, value: { path: '', entries: [], truncated: false } }) },
    browser: browserVisibility,
    getState: () => ({
      line: 1,
      depth: 2,
      outlineDepth: 2,
      outline: true,
      focus: false,
      width: 200,
      history: { canGoBack: false, canGoForward: false },
    }),
    sessionId: () => ({ sessionId: 's', path: 'demo.jsonl' }),
  };
  const closedMarkup = renderToString(React.createElement(body, props));
  assert.match(closedMarkup, /data-jsonl-viewer/);
  assert.match(closedMarkup, /aria-expanded="false"/);
  browserVisibility.setOpen(true);
  const openMarkup = renderToString(React.createElement(body, props));
  assert.match(openMarkup, /class="jsonl-file-browser"/);
  assert.match(openMarkup, /aria-label="\/workspace"/);
  assert.doesNotMatch(openMarkup, /type="search"/);
  browserVisibility.setOpen(false);
  for (const dispose of effects.reverse()) {
    const value = await dispose;
    if (typeof value === 'function') await value();
  }

  // Exercise optional registration, Session admission, SSR and disposal.
  effects.length = 0;
  ctx.betterSidebar = {};
  let definition,
    released = false;
  ctx.sidebarRightTabs = {
    register(value) {
      definition = value;
      return () => {
        released = true;
      };
    },
  };
  plugin.apply(ctx);
  assert.equal(typeof nativeBody, 'function');
  assert.equal(definition.priority, 'extension');
  assert.ok(
    definition.patterns.every((pattern) => pattern.length > 'dsh-resource://file/**'.length),
  );
  for (const path of ['demo.jsonl', 'sub/UPPER.NDJSON', 'with%20space/data.jsonl']) {
    assert.ok(definition.canOpen(`dsh-resource://file/session/s/${path}`));
  }
  assert.equal(definition.canOpen('https://example.com/demo.jsonl'), false);
  const nativeProps = {
    ...props,
    useTabInfo: () => ({
      tab: {
        id: 'native-test',
        contentId: props.resourceAddress,
        signal: new AbortController().signal,
        navigation: { revision: 1 },
        actions: {
          bindCommands() {
            return () => {};
          },
        },
      },
    }),
  };
  assert.match(renderToString(React.createElement(nativeBody, nativeProps)), /data-jsonl-viewer/);
  for (const dispose of effects.reverse()) {
    const value = await dispose;
    if (typeof value === 'function') await value();
  }
  assert.equal(released, true);

  assert.equal(pkg.scripts?.prepare, undefined);
  console.log('Package entries, workers, Client factory and offline paths verified');
} finally {
  await rm(dir, { recursive: true, force: true });
}
