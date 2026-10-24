/** Exercise the actual React tree, including native resource remounts and request lifetimes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import {
  JsonlPreview,
  type PreviewProps,
} from '../packages/plugins/large-jsonl-viewer/src/client/JsonlPreview.tsx';
import { createTabStore } from '../packages/plugins/large-jsonl-viewer/src/client/store.ts';

async function fixture(run: (value: any) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' }),
    host = dom.window.document.getElementById('root')!,
    globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true },
    previous = new Map(
      Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    ),
    store = createTabStore(),
    abort = new AbortController(),
    requests: { path: string; signal: AbortSignal }[] = [],
    opened: string[] = [],
    duplicateKeys: unknown[][] = [],
    originalError = console.error;
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  console.error = (...args) => {
    if (String(args[0]).includes('same key')) duplicateKeys.push(args);
    else originalError(...args);
  };
  const { createRoot } = await import('react-dom/client'),
    root = createRoot(host);
  const directories: Record<string, { name: string; type: 'file' | 'directory' | 'other' }[]> = {
    '.': [
      { name: 'data', type: 'directory' },
      { name: 'other', type: 'directory' },
      { name: 'alpha.jsonl', type: 'file' },
      { name: 'beta.ndjson', type: 'file' },
      { name: 'notes.txt', type: 'file' },
      { name: 'pipe', type: 'other' },
    ],
    data: [
      { name: 'inner', type: 'directory' },
      { name: 'one.jsonl', type: 'file' },
    ],
    'data/inner': [{ name: '中文 #数据.NDJSON', type: 'file' }],
    other: [{ name: 'late.jsonl', type: 'file' }],
  };
  let workingDirectory: string | undefined = '/workspace';
  let failOther = false,
    pendingOther: ((value: unknown) => void) | undefined,
    holdInner = false,
    pendingInner: ((value: unknown) => void) | undefined;
  const props = {
    useTabInfo: () => ({
      tab: {
        id: 'file-browser-test',
        signal: abort.signal,
        navigation: { revision: 0 },
        actions: { openResource: (address: string) => opened.push(address) },
      },
    }),
    useSessions: (selector: any) => selector({ byId: { fixture: { cwd: workingDirectory } } }),
    resourceAddress: 'dsh-resource://file/session/fixture/alpha.jsonl',
    content: { kind: 'renderer', revision: 1, loaded() {}, failed() {}, reload() {} },
    wrap: true,
    t: (key: string) => key,
    api: {},
    browser: store.browser,
    getState: store.get,
    sessionId: () => ({ sessionId: 'fixture', path: props.resourceAddress.split('/fixture/')[1] }),
    supervise: () => ({ async *[Symbol.asyncIterator]() {}, dispose() {} }),
    files: {
      list: async (_session: string, path: string, signal: AbortSignal) => {
        requests.push({ path, signal });
        assert.ok(
          path.startsWith(workingDirectory!),
          'Every listing must start at the session cwd',
        );
        path = path === workingDirectory ? '.' : path.slice(workingDirectory!.length + 1);
        assert.notEqual(path, '', 'The Host rejects an empty root directory request');
        assert.ok(
          directories[path],
          'A collapsed folder must not trigger arbitrary recursive reads',
        );
        if (path === 'other' && failOther) return { ok: false, error: { code: 'unavailable' } };
        if (path === 'other')
          return new Promise((resolve) => {
            pendingOther = resolve;
          });
        if (path === 'data/inner' && holdInner)
          return new Promise((resolve) => {
            pendingInner = resolve;
          });
        return {
          ok: true,
          value: { path: path === '.' ? '' : path, truncated: false, entries: directories[path] },
        };
      },
    },
  } as unknown as PreviewProps;
  const row = (path: string): HTMLElement => {
    const item = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (item) => item.dataset.path === (path.startsWith('/') ? path : workingDirectory + '/' + path),
    );
    assert.ok(item, 'Missing tree row: ' + path);
    return item;
  };
  const click = async (path: string) =>
    act(async () => {
      (row(path).firstElementChild as HTMLElement).click();
    });
  const control = async (name: string) =>
    act(async () => {
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]');
      assert.ok(button, 'Missing control: ' + name);
      button.click();
    });
  const key = async (path: string, key: string) =>
    act(async () => {
      row(path).focus();
      row(path).dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    });
  const render = async (path = 'alpha.jsonl') =>
    act(async () => {
      props.resourceAddress = 'dsh-resource://file/session/fixture/' + path;
      root.render(React.createElement(JsonlPreview, { ...props }));
    });
  try {
    await render();
    await run({
      dom,
      host,
      store,
      requests,
      opened,
      row,
      click,
      control,
      key,
      render,
      detach: () => act(async () => root.render(null)),
      delayInner: () => {
        holdInner = true;
      },
      finishInner: () =>
        pendingInner?.({
          ok: true,
          value: { path: 'data/inner', entries: directories['data/inner'], truncated: false },
        }),
      directories,
      setCwd: (cwd: string | undefined) => {
        workingDirectory = cwd;
      },
      failOther: () => {
        failOther = true;
      },
      holdOther: () => {
        failOther = false;
      },
      finishOther: () =>
        pendingOther?.({
          ok: true,
          value: { path: 'other', truncated: false, entries: directories.other },
        }),
    });
    assert.deepEqual(duplicateKeys, []);
  } finally {
    await act(async () => root.unmount());
    abort.abort();
    store.dispose();
    dom.window.close();
    console.error = originalError;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test(
  'file tree opens and closes repeatedly without duplicate panes or retained requests',
  { timeout: 10000 },
  async () => {
    await fixture(async ({ host, store, requests, opened, click }) => {
      assert.equal(host.querySelectorAll('.jsonl-file-browser').length, 0);
      for (let i = 0; i < 3; i++) {
        await act(async () => host.querySelector('.jsonl-toolbar button[aria-controls]').click());
        assert.equal(host.querySelectorAll('.jsonl-file-browser').length, 1);
        assert.deepEqual(
          [...host.querySelectorAll('[role="treeitem"]')].map((item: any) =>
            item.getAttribute('aria-label'),
          ),
          ['data', 'other', 'alpha.jsonl', 'beta.ndjson', 'notes.txt', 'pipe'],
        );
        await act(async () => host.querySelector('button[aria-label="hideFiles"]').click());
        assert.equal(host.querySelectorAll('.jsonl-file-browser').length, 0);
        assert.equal(requests.at(-1).signal.aborted, true);
      }
      assert.ok(requests.every((request: any) => request.path === '/workspace'));
      await act(async () => store.browser.setOpen(true));
      await click('beta.ndjson');
      assert.deepEqual(opened, ['dsh-resource://file/session/fixture/beta.ndjson']);
    });
  },
);

test(
  'lazy tree keeps parents and siblings, preserves expansion, reveals files and supports keyboard navigation',
  { timeout: 10000 },
  async () => {
    await fixture(async ({ host, store, requests, row, click, control, key, render, opened }) => {
      await act(async () => store.browser.setOpen(true));
      assert.deepEqual(
        requests.map((request: any) => request.path),
        ['/workspace'],
      );
      await key('data', 'ArrowRight');
      assert.equal(row('data').getAttribute('aria-expanded'), 'true');
      assert.equal(row('data/one.jsonl').getAttribute('aria-level'), '2');
      assert.ok(row('alpha.jsonl'), 'Opening a folder must keep its siblings visible');
      assert.ok(!requests.some((request: any) => request.path === '/workspace/data/inner'));
      await key('data', 'ArrowRight');
      assert.equal(host.ownerDocument.activeElement, row('data/inner'));
      await key('data/inner', 'ArrowRight');
      assert.equal(row('data/inner/中文 #数据.NDJSON').getAttribute('aria-level'), '3');
      await key('data/inner/中文 #数据.NDJSON', 'ArrowLeft');
      assert.equal(host.ownerDocument.activeElement, row('data/inner'));
      await key('data/inner', 'ArrowDown');
      assert.equal(host.ownerDocument.activeElement, row('data/inner/中文 #数据.NDJSON'));
      await click('data/inner/中文 #数据.NDJSON');
      assert.equal(
        opened.at(-1),
        'dsh-resource://file/session/fixture/data/inner/%E4%B8%AD%E6%96%87%20%23%E6%95%B0%E6%8D%AE.NDJSON',
      );
      await render('data/one.jsonl');
      assert.equal(row('data/one.jsonl').getAttribute('aria-current'), 'page');
      assert.equal(
        row('data/inner').getAttribute('aria-expanded'),
        'true',
        'Manual expansion survives switching resources',
      );
      assert.ok(row('alpha.jsonl'));
      await control('collapseFolders');
      assert.equal(row('data').getAttribute('aria-expanded'), 'false');
      assert.equal(host.querySelector('[role="group"]'), null);
      await control('locateFile');
      assert.equal(row('data/one.jsonl').getAttribute('aria-current'), 'page');
      assert.equal(row('data/inner').getAttribute('aria-expanded'), 'false');
      await key('data', 'ArrowLeft');
      assert.equal(row('data').getAttribute('aria-expanded'), 'false');
      assert.ok(
        requests
          .filter((request: any) => request.path === '/workspace/data')
          .every((request: any) => request.signal.aborted),
      );
      await render('data/inner/中文 #数据.NDJSON');
      assert.equal(row('data/inner/中文 #数据.NDJSON').getAttribute('aria-current'), 'page');
      assert.equal(host.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
      await key('data', 'End');
      assert.equal(host.ownerDocument.activeElement, row('notes.txt'));
      await key('beta.ndjson', 'Home');
      assert.equal(host.ownerDocument.activeElement, row('data'));
    });
  },
);

test(
  'folder errors are retryable and collapsing a loading branch ignores late replies',
  { timeout: 10000 },
  async () => {
    await fixture(
      async ({ host, store, requests, row, click, control, failOther, holdOther, finishOther }) => {
        failOther();
        await act(async () => store.browser.setOpen(true));
        await click('other');
        assert.match(row('other').textContent, /filesFailed/);
        holdOther();
        await act(async () => row('other').querySelector('button').click());
        const request = requests.at(-1);
        assert.equal(request.path, '/workspace/other');
        assert.equal(request.signal.aborted, false);
        await click('other');
        assert.equal(request.signal.aborted, true);
        await act(async () => finishOther());
        assert.equal(row('other').getAttribute('aria-expanded'), 'false');
        assert.equal(host.querySelector('[data-path="/workspace/other/late.jsonl"]'), null);
        const before = requests.length;
        await control('refreshFiles');
        assert.deepEqual(
          requests.slice(before).map((request: any) => request.path),
          ['/workspace'],
          'Refreshing must not crawl collapsed folders',
        );
      },
    );
  },
);

test(
  'absolute resources are revealed under the session cwd without choosing their parent as the root',
  { timeout: 10000 },
  async () => {
    await fixture(async ({ store, render, row, requests }) => {
      await render('/workspace/data/inner/中文 #数据.NDJSON');
      await act(async () => store.browser.setOpen(true));
      assert.equal(row('data/inner/中文 #数据.NDJSON').getAttribute('aria-current'), 'page');
      assert.equal(row('data').getAttribute('aria-expanded'), 'true');
      assert.ok(requests.some((request: any) => request.path === '/workspace/data/inner'));
      assert.ok(requests.some((request: any) => request.path === '/workspace'));
      assert.ok(!requests.some((request: any) => request.path === '/workspace/other'));
    });
  },
);

test(
  'the complete working directory is shown and ordinary files use native opening',
  { timeout: 10000 },
  async () => {
    await fixture(async ({ store, host, click, opened, row, requests }) => {
      await act(async () => store.browser.setOpen(true));
      assert.equal(host.querySelector('.jsonl-file-path').getAttribute('title'), '/workspace');
      assert.equal(host.querySelector('input[type="search"]'), null);
      assert.equal(row('pipe').getAttribute('aria-disabled'), 'true');
      await click('pipe');
      assert.deepEqual(opened, []);
      await click('notes.txt');
      assert.deepEqual(opened, ['dsh-resource://file/session/fixture/notes.txt']);
      assert.deepEqual(
        requests.map((request: any) => request.path),
        ['/workspace'],
      );
    });
  },
);

test(
  'missing or changed session cwd never falls back to the current file directory or process cwd',
  { timeout: 10000 },
  async () => {
    await fixture(async ({ store, host, render, setCwd, requests }) => {
      setCwd(undefined);
      await render('data/one.jsonl');
      await act(async () => store.browser.setOpen(true));
      assert.match(host.textContent, /noWorkspace/);
      assert.equal(requests.length, 0);
      setCwd('/another-workspace');
      await render('alpha.jsonl');
      assert.equal(
        host.querySelector('.jsonl-file-path').getAttribute('title'),
        '/another-workspace',
      );
      assert.deepEqual(
        requests.map((request: any) => request.path),
        ['/another-workspace'],
      );
    });
  },
);

/** Model browser scroll clamping while deeper, restored directories are still loading. */
function emulateTreeLayout(dom: JSDOM) {
  const tops = new WeakMap<HTMLElement, number>();
  let reveals = 0;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return tops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      const max = this.querySelector('[data-path="/workspace/data/inner/中文 #数据.NDJSON"]')
        ? 1000
        : 50;
      tops.set(this, Math.min(max, Math.max(0, value)));
    },
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {
    reveals++;
  };
  return { reveals: () => reveals };
}

test(
  'file tree keeps its scrollport across file changes and restores after delayed subtree loading',
  { timeout: 10000 },
  async () => {
    await fixture(
      async ({ dom, host, store, click, control, render, detach, delayInner, finishInner }) => {
        const layout = emulateTreeLayout(dom),
          workspaceKey = JSON.stringify(['fixture', '/workspace']);
        await act(async () => store.browser.setOpen(true));
        await click('data');
        await click('data/inner');
        const scroller = host.querySelector('.jsonl-file-list');
        scroller.scrollTop = 360;
        await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')));
        assert.equal(store.browser.getScrollTop(workspaceKey), 360);
        const before = layout.reveals();
        await render('data/inner/中文 #数据.NDJSON');
        assert.equal(
          host.querySelector('.jsonl-file-list'),
          scroller,
          'Reusing the file body must keep the scrollport',
        );
        assert.equal(scroller.scrollTop, 360);
        assert.equal(
          layout.reveals(),
          before,
          'Switching files must not automatically scroll to the new selection',
        );
        await detach();
        delayInner();
        await render('data/one.jsonl');
        const restored = host.querySelector('.jsonl-file-list');
        assert.equal(restored.scrollTop, 50, 'The partial tree cannot yet hold the saved offset');
        assert.equal(
          store.browser.getScrollTop(workspaceKey),
          360,
          'Do not overwrite the target with a partially clamped offset',
        );
        await act(async () => restored.dispatchEvent(new dom.window.Event('scroll')));
        assert.equal(store.browser.getScrollTop(workspaceKey), 360);
        await act(async () => finishInner());
        assert.equal(
          restored.scrollTop,
          360,
          'Native tab remounts restore once expanded levels finish loading',
        );
        assert.equal(layout.reveals(), before);
        await control('locateFile');
        assert.equal(
          layout.reveals(),
          before + 1,
          'Explicit reveal still scrolls to the selected file',
        );
        await control('hideFiles');
        await act(async () => store.browser.setOpen(true));
        await act(async () => finishInner());
        assert.equal(host.querySelector('.jsonl-file-list').scrollTop, 360);
      },
    );
  },
);

test(
  'user scroll during tree restoration cancels the pending restore instead of pulling the viewport back',
  { timeout: 10000 },
  async () => {
    await fixture(async ({ dom, host, store, delayInner, finishInner }) => {
      emulateTreeLayout(dom);
      const workspaceKey = JSON.stringify(['fixture', '/workspace']);
      store.browser.setExpanded(workspaceKey, ['/workspace/data', '/workspace/data/inner']);
      store.browser.setScrollTop(workspaceKey, 360);
      delayInner();
      await act(async () => store.browser.setOpen(true));
      const scroller = host.querySelector('.jsonl-file-list');
      assert.equal(scroller.scrollTop, 50);
      await act(async () =>
        scroller.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, deltaY: -30 })),
      );
      scroller.scrollTop = 20;
      await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')));
      assert.equal(store.browser.getScrollTop(workspaceKey), 20);
      await act(async () => finishInner());
      assert.equal(scroller.scrollTop, 20);
    });
  },
);
