/** A lazy workspace tree: only the root and expanded folders own live directory listings. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { WorkspaceDirectoryListing } from '@deepseek-ai/dsh-api-workspace-files/types';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path';
import type { ViewerFace } from './face.ts';
import type { FileBrowserVisibility } from './store.ts';
import type { Key } from './locales.ts';
import {
  childPath,
  directoryEntries,
  workspaceTreeRoot,
  workspaceTreeFile,
  workspaceTreeAncestors,
} from './file-browser.ts';

type BrowserProps = {
  id: string;
  files: ViewerFace['files'];
  preferences: FileBrowserVisibility;
  current: { sessionId: SessionId; path: string };
  cwd: string | undefined;
  signal: AbortSignal;
  onOpen(path: string): void;
  onClose(): void;
  t(key: Key): string;
};
type BranchProps = Pick<BrowserProps, 'files' | 'current' | 'signal' | 't'> & {
  directory: string;
  level: number;
  expanded: ReadonlySet<string>;
  selected?: string;
  revision: number;
  toggle(path: string): void;
  open(path: string): void;
  ready(): void;
};

export function FileBrowser(props: BrowserProps) {
  const root = workspaceTreeRoot(props.cwd);
  if (root) return <WorkspaceTree {...props} root={root} />;
  return (
    <aside id={props.id} className="jsonl-file-browser" aria-label={props.t('files')}>
      <div className="jsonl-file-heading">
        <strong>{props.t('files')}</strong>
        <button aria-label={props.t('hideFiles')} onClick={props.onClose}>
          <ToolIcon kind="close" />
        </button>
      </div>
      <p className="jsonl-file-message">{props.t('noWorkspace')}</p>
    </aside>
  );
}

function WorkspaceTree({
  id,
  files,
  preferences,
  current,
  root,
  signal,
  onOpen,
  onClose,
  t,
}: BrowserProps & { root: string }) {
  const selected = workspaceTreeFile(root, current.path),
    preferenceKey = JSON.stringify([current.sessionId, root]),
    rootParts = pathPartsOf(root);
  const [expanded, setExpanded] = useState(
      () =>
        new Set([
          ...preferences.getExpanded(preferenceKey),
          ...workspaceTreeAncestors(root, selected),
        ]),
    ),
    [revision, setRevision] = useState(0);
  const tree = useRef<HTMLDivElement>(null),
    focused = useRef<string>(),
    restoreTop = useRef(preferences.getScrollTop(preferenceKey)),
    reveal = useRef(restoreTop.current === undefined),
    typeahead = useRef({ value: '', time: 0 });
  const saveExpanded = (next: Set<string>) => {
    preferences.setExpanded(preferenceKey, [...next]);
    setExpanded(next);
  };
  useEffect(() => {
    preferences.setExpanded(preferenceKey, [...expanded]);
  }, []);
  useEffect(() => {
    // A reused file body keeps the same scrollport; only reveal newly needed ancestors.
    setExpanded((previous) => {
      const ancestors = workspaceTreeAncestors(root, selected);
      if (ancestors.every((path) => previous.has(path))) return previous;
      const next = new Set([...previous, ...ancestors]);
      preferences.setExpanded(preferenceKey, [...next]);
      return next;
    });
  }, [selected, root, preferences, preferenceKey]);
  function rememberScroll() {
    if (tree.current && restoreTop.current === undefined)
      preferences.setScrollTop(preferenceKey, tree.current.scrollTop);
  }
  function stopRestoring() {
    restoreTop.current = undefined;
    reveal.current = false;
    rememberScroll();
  }
  function open(path: string) {
    rememberScroll();
    onOpen(path);
  }

  // One roving tab stop. Directory effects update it after asynchronous children appear.
  const ready = useCallback(() => {
    const rows = [
        ...(tree.current?.querySelectorAll<HTMLElement>(
          '[role="treeitem"]:not([aria-disabled="true"])',
        ) ?? []),
      ],
      currentRow = rows.find((row) => row.dataset.path === selected),
      target = rows.find((row) => row.dataset.path === focused.current) ?? currentRow ?? rows[0];
    for (const row of rows) row.tabIndex = row === target ? 0 : -1;
    if (tree.current && restoreTop.current !== undefined) {
      tree.current.scrollTop = restoreTop.current;
      // Deeper expanded levels can still be loading above the viewport. Keep restoring until
      // the visible tree has finished loading, even if a shorter partial tree clamps the offset.
      if (!tree.current.querySelector('[aria-busy="true"]')) {
        restoreTop.current = undefined;
        preferences.setScrollTop(preferenceKey, tree.current.scrollTop);
      }
    }
    if (reveal.current && currentRow) {
      currentRow.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      reveal.current = false;
      if (tree.current) preferences.setScrollTop(preferenceKey, tree.current.scrollTop);
    }
  }, [selected, preferences, preferenceKey]);
  useEffect(ready, [ready, expanded]);
  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) {
      for (const folder of next)
        if (folder === path || folder.startsWith(path + '/')) next.delete(folder);
    } else next.add(path);
    saveExpanded(next);
  }
  function locate() {
    restoreTop.current = undefined;
    reveal.current = true;
    saveExpanded(new Set([...expanded, ...workspaceTreeAncestors(root, selected)]));
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (
      !row ||
      row.getAttribute('aria-disabled') === 'true' ||
      event.target !== row ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    stopRestoring();
    const rows = [
        ...tree.current!.querySelectorAll<HTMLElement>(
          '[role="treeitem"]:not([aria-disabled="true"])',
        ),
      ],
      index = rows.indexOf(row),
      path = row.dataset.path!,
      folder = row.hasAttribute('aria-expanded');
    let target: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1];
        break;
      case 'ArrowUp':
        target = rows[index - 1];
        break;
      case 'Home':
        target = rows[0];
        break;
      case 'End':
        target = rows.at(-1);
        break;
      case 'ArrowRight':
        if (folder && !expanded.has(path)) toggle(path);
        else if (folder)
          target =
            row.querySelector<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])') ??
            undefined;
        break;
      case 'ArrowLeft':
        if (folder && expanded.has(path)) toggle(path);
        else target = row.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined;
        break;
      case 'Enter':
      case ' ':
        if (folder) toggle(path);
        else if (path !== selected) open(path);
        break;
      default: {
        if (event.key.length !== 1) return;
        const now = Date.now();
        typeahead.current = {
          value:
            (now - typeahead.current.time < 700 ? typeahead.current.value : '') +
            event.key.toLocaleLowerCase(),
          time: now,
        };
        target = [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((item) =>
          item.getAttribute('aria-label')?.toLocaleLowerCase().startsWith(typeahead.current.value),
        );
      }
    }
    event.preventDefault();
    event.stopPropagation();
    target?.focus();
  }
  return (
    <aside id={id} className="jsonl-file-browser" aria-label={t('files')}>
      <div className="jsonl-file-heading">
        <strong>{t('files')}</strong>
        <span className="jsonl-file-tools">
          <button
            title={t('locateFile')}
            aria-label={t('locateFile')}
            disabled={!selected}
            onClick={locate}
          >
            <ToolIcon kind="locate" />
          </button>
          <button
            title={t('collapseFolders')}
            aria-label={t('collapseFolders')}
            onClick={() => saveExpanded(new Set())}
          >
            <ToolIcon kind="collapse" />
          </button>
          <button
            title={t('hideFiles')}
            aria-label={t('hideFiles')}
            onClick={() => {
              rememberScroll();
              onClose();
            }}
          >
            <ToolIcon kind="close" />
          </button>
        </span>
      </div>
      <div className="jsonl-file-root">
        <span className="jsonl-file-path" title={root} aria-label={root}>
          <span className="jsonl-file-path-prefix">{rootParts.directory}</span>
          <strong>{rootParts.name}</strong>
        </span>
        <button
          title={t('refreshFiles')}
          aria-label={t('refreshFiles')}
          onClick={() => setRevision((n) => n + 1)}
        >
          <ToolIcon kind="refresh" />
        </button>
      </div>
      <div
        ref={tree}
        className="jsonl-file-list"
        onScroll={rememberScroll}
        onWheelCapture={stopRestoring}
        onPointerDownCapture={stopRestoring}
        onTouchStartCapture={stopRestoring}
        onKeyDown={keyDown}
        onFocus={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
          if (row) {
            focused.current = row.dataset.path;
            ready();
          }
        }}
      >
        <Directory
          directory={root}
          level={1}
          files={files}
          current={current}
          signal={signal}
          t={t}
          expanded={expanded}
          selected={selected}
          revision={revision}
          toggle={toggle}
          open={open}
          ready={ready}
        />
      </div>
    </aside>
  );
}

function Directory(props: BranchProps) {
  const [listing, setListing] = useState<WorkspaceDirectoryListing>(),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const { files, current, directory, revision, signal, ready } = props;
  useEffect(() => {
    const controller = new AbortController(),
      lifetime = AbortSignal.any([signal, controller.signal]);
    setLoading(true);
    setFailed(false);
    void files
      .list(current.sessionId, directory, lifetime)
      .then((result) => {
        if (lifetime.aborted) return;
        if (result.ok) setListing(result.value);
        else {
          setListing(undefined);
          setFailed(true);
        }
      })
      .catch(() => {
        if (!lifetime.aborted) {
          setListing(undefined);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!lifetime.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [files, current.sessionId, directory, revision, retry, signal]);
  useEffect(ready, [ready, listing, loading, props.expanded]);
  const entries = directoryEntries(listing?.entries ?? []);
  return (
    <ul
      role={props.level === 1 ? 'tree' : 'group'}
      aria-label={props.level === 1 ? props.t('files') : undefined}
      aria-busy={loading}
    >
      {entries.map((entry) => {
        const path = childPath(directory, entry.name),
          folder = entry.type === 'directory',
          disabled = entry.type === 'other',
          open = folder && props.expanded.has(path);
        return (
          <li
            key={path}
            role="treeitem"
            aria-label={entry.name}
            aria-level={props.level}
            aria-disabled={disabled || undefined}
            aria-expanded={folder ? open : undefined}
            aria-selected={!folder && path === props.selected}
            aria-current={!folder && path === props.selected ? 'page' : undefined}
            data-path={path}
            tabIndex={-1}
          >
            <div
              className="jsonl-file-row"
              title={path}
              onClick={(event) => {
                if (disabled) return;
                event.currentTarget.parentElement!.focus({ preventScroll: true });
                if (folder) props.toggle(path);
                else if (path !== props.selected) props.open(path);
              }}
            >
              <FileIcon folder={folder} open={open} />
              <span>{entry.name}</span>
            </div>
            {open && <Directory {...props} directory={path} level={props.level + 1} />}
          </li>
        );
      })}
      {loading && (
        <li role="none" className="jsonl-file-message">
          <span role="status">{props.t('loadingFiles')}</span>
        </li>
      )}
      {failed && (
        <li role="none" className="jsonl-file-message">
          <span role="alert">{props.t('filesFailed')}</span>{' '}
          <button onClick={() => setRetry((n) => n + 1)}>{props.t('retry')}</button>
        </li>
      )}
      {!loading && !failed && entries.length === 0 && (
        <li role="none" className="jsonl-file-message">
          {props.t('noFiles')}
        </li>
      )}
      {listing?.truncated && (
        <li role="none" className="jsonl-file-message">
          <span role="status">{props.t('filesTruncated')}</span>
        </li>
      )}
    </ul>
  );
}

function FileIcon({ folder, open = false }: { folder: boolean; open?: boolean }) {
  return (
    <svg
      className={folder ? 'jsonl-folder-icon' : 'jsonl-document-icon'}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={
          folder
            ? open
              ? 'M2 8V3h6l2 2h8v3 M2 8h17l-3 9H2z'
              : 'M2 5h6l2 2h8v10H2z M2 5V3h6l2 2'
            : 'M5 2h7l4 4v12H5z M12 2v5h4 M8 11h5 M8 14h5'
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolIcon({ kind }: { kind: 'refresh' | 'locate' | 'collapse' | 'close' }) {
  const paths = {
    refresh: 'M13 5a6 6 0 1 0 1 6 M13 1v4H9',
    locate: 'M8 1v3 M8 12v3 M1 8h3 M12 8h3 M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M8 7v2',
    collapse: 'M5 2h8v9 M3 5h8v9H3z M5 9h4',
    close: 'M4 4l8 8 M12 4l-8 8',
  };
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={paths[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
