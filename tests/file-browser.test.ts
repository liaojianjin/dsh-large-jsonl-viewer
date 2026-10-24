import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import {
  childPath,
  directoryEntries,
  ancestorDirectories,
  relativeFilePath,
  workspaceTreeRoot,
  workspaceTreeFile,
  workspaceTreeAncestors,
} from '../packages/plugins/large-jsonl-viewer/src/client/file-browser.ts';
import { createTabStore } from '../packages/plugins/large-jsonl-viewer/src/client/store.ts';

test('directory navigation preserves Host path grammar and encoded file names', () => {
  assert.deepEqual(ancestorDirectories('data/nested/demo.jsonl'), ['data', 'data/nested']);
  assert.deepEqual(ancestorDirectories('demo.jsonl'), []);
  assert.deepEqual(ancestorDirectories('/absolute/demo.jsonl'), []);
  assert.equal(relativeFilePath('./data\\demo.jsonl'), 'data/demo.jsonl');
  assert.equal(relativeFilePath('../outside.jsonl'), undefined);
  assert.equal(relativeFilePath('C:\\demo.jsonl'), undefined);
  const path = childPath('data', '中文 #?%.NDJSON');
  assert.deepEqual(parseFileAddress(sessionFileAddress('session #1', path)), {
    scope: 'session',
    sessionId: 'session #1',
    path,
  });
  for (const name of ['..', '.', '../secret.jsonl', 'nested/file.jsonl', 'nested\\file.jsonl', ''])
    assert.throws(() => childPath('data', name));
});

test('tree expansion preferences survive resource remounts and remain bounded per session', () => {
  const store = createTabStore();
  store.browser.setExpanded('session', ['data', 'data/nested', 'data']);
  assert.deepEqual(store.browser.getExpanded('session'), ['data', 'data/nested']);
  store.browser.setOpen(true);
  store.browser.setOpen(false);
  assert.deepEqual(store.browser.getExpanded('session'), ['data', 'data/nested']);
  store.browser.setExpanded(
    'session',
    Array.from({ length: 200 }, (_, i) => 'folder' + i),
  );
  assert.equal(store.browser.getExpanded('session').length, 128);
  for (let i = 0; i < 32; i++) store.browser.setExpanded('s' + i, ['data']);
  assert.deepEqual(store.browser.getExpanded('session'), []);
  store.dispose();
  assert.deepEqual(store.browser.getExpanded('s31'), []);
  store.browser.setExpanded('s31', ['data']);
  assert.deepEqual(store.browser.getExpanded('s31'), []);
});

test('file tree is folder-first, includes ordinary files and special entries, and never mutates the Host listing', () => {
  const entries = [
    { name: '10.JSONL', type: 'file' as const },
    { name: 'notes.md', type: 'file' as const },
    { name: '2.ndjson', type: 'file' as const },
    { name: 'data', type: 'directory' as const },
    { name: '..', type: 'directory' as const },
    { name: 'device.jsonl', type: 'other' as const },
  ];
  const before = structuredClone(entries);
  assert.deepEqual(
    directoryEntries(entries).map((entry) => entry.name),
    ['data', '2.ndjson', '10.JSONL', 'device.jsonl', 'notes.md'],
  );
  assert.deepEqual(entries, before);
});

test('file browser stays open across tabs while record positions and histories stay file-specific', () => {
  const store = createTabStore(),
    abort = new AbortController();
  let notifications = 0;
  const unsubscribe = store.browser.subscribe(() => notifications++);
  store.browser.setOpen(true);
  const first = store.get('tab', abort.signal, 'first.jsonl');
  first.line = 99;
  first.history.requestVisit(99);
  first.history.commit(99);
  const second = store.get('tab', abort.signal, 'second.jsonl');
  assert.equal(second.line, 1);
  assert.equal(second.history.canGoBack, false);
  assert.equal(store.get('tab', abort.signal, 'first.jsonl'), first);
  assert.equal(store.browser.getSnapshot(), true);
  assert.equal(store.get('another-tab', abort.signal, 'first.jsonl').line, 1);
  store.browser.setOpen(true);
  assert.equal(notifications, 1);
  unsubscribe();
  store.browser.setOpen(false);
  assert.equal(notifications, 1);
  store.dispose();
});

test('per-tab file preferences are bounded and use one abort listener per tab', () => {
  const store = createTabStore(),
    abort = new AbortController();
  const first = store.get('tab', abort.signal, '0.jsonl');
  first.line = 99;
  for (let i = 1; i <= 40; i++) store.get('tab', abort.signal, i + '.jsonl');
  assert.equal(getEventListeners(abort.signal, 'abort').length, 1);
  assert.equal(store.get('tab', abort.signal, '0.jsonl').line, 1);
  const other = new AbortController();
  store.get('tab', other.signal, '1.jsonl');
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  other.abort();
  assert.equal(getEventListeners(other.signal, 'abort').length, 0);
  const closed = store.get('tab', other.signal, '1.jsonl');
  closed.line = 42;
  assert.equal(store.get('tab', other.signal, '1.jsonl').line, 1);
  store.dispose();
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('tree root and selection follow the session working directory including filesystem roots', () => {
  assert.equal(workspaceTreeRoot('/project/'), '/project');
  assert.equal(workspaceTreeRoot('/'), '/');
  assert.equal(workspaceTreeRoot('C:\\'), 'C:/');
  assert.equal(workspaceTreeRoot('\\\\server\\share'), '//server/share');
  assert.equal(workspaceTreeRoot(undefined), undefined);
  assert.equal(workspaceTreeRoot('relative'), undefined);
  assert.equal(workspaceTreeFile('/project', 'data/a.jsonl'), '/project/data/a.jsonl');
  assert.equal(workspaceTreeFile('/project', '/project/data/a.jsonl'), '/project/data/a.jsonl');
  assert.equal(workspaceTreeFile('/project', '/project-other/a.jsonl'), undefined);
  assert.equal(workspaceTreeFile('/project', '../secret.jsonl'), undefined);
  assert.deepEqual(workspaceTreeAncestors('/project', '/project/data/nested/a.jsonl'), [
    '/project/data',
    '/project/data/nested',
  ]);
  assert.deepEqual(workspaceTreeAncestors('/', '/data/a.jsonl'), ['/data']);
  assert.equal(workspaceTreeFile('C:/', 'data\\a.jsonl'), 'C:/data/a.jsonl');
  assert.deepEqual(workspaceTreeAncestors('C:/', 'C:/data/a.jsonl'), ['C:/data']);
});

test('tree scroll position is workspace-specific, bounded and retained alongside expansion', () => {
  const store = createTabStore();
  assert.equal(store.browser.getScrollTop('a'), undefined);
  store.browser.setScrollTop('a', 0);
  assert.equal(
    store.browser.getScrollTop('a'),
    0,
    'Zero is a saved position, not first-open absence',
  );
  store.browser.setScrollTop('a', 360.5);
  store.browser.setExpanded('a', ['data']);
  assert.equal(store.browser.getScrollTop('a'), 360.5);
  assert.equal(store.browser.getScrollTop('b'), undefined);
  store.browser.setScrollTop('a', NaN);
  assert.equal(store.browser.getScrollTop('a'), 360.5);
  for (let i = 0; i < 32; i++) store.browser.setScrollTop('other' + i, i);
  assert.equal(store.browser.getScrollTop('a'), undefined);
  assert.deepEqual(store.browser.getExpanded('a'), []);
  store.dispose();
  store.browser.setScrollTop('a', 360);
  assert.equal(store.browser.getScrollTop('a'), undefined);
});
