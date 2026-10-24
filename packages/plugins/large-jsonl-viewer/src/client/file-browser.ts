/** The tree uses absolute Session cwd paths, independently of workspace-relative listing replies. */
import {
  isAbsoluteWorkspacePath,
  resolveWorkspacePath,
} from '@deepseek-ai/dsh-util-workspace-path';
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types';

/** Validate only the relative portion used to reveal a file beneath cwd. */
export function relativeFilePath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  return normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some((part) => !validName(part))
    ? undefined
    : normalized;
}

export function ancestorDirectories(path: string): string[] {
  const parts = relativeFilePath(path)?.split('/') ?? [];
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function validName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name);
}

export function childPath(directory: string, name: string): string {
  if (!validName(name)) throw new Error('Expected a directory entry basename');
  return (directory ? directory.replace(/[/\\]+$/, '').replace(/\\/g, '/') + '/' : '') + name;
}

export function directoryEntries(
  entries: readonly WorkspaceDirectoryEntry[],
): WorkspaceDirectoryEntry[] {
  return entries
    .filter((entry) => validName(entry.name))
    .sort(
      (a, b) =>
        Number(b.type === 'directory') - Number(a.type === 'directory') ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

/** Match the official tree: the Session's absolute cwd is the root, never the opened file's parent. */
export function workspaceTreeRoot(cwd: string | undefined): string | undefined {
  if (!cwd || !isAbsoluteWorkspacePath(cwd)) return undefined;
  const path = cwd.replace(/\\/g, '/');
  const trimmed = path.replace(/\/+$/, '');
  return !trimmed ? '/' : /^[a-z]:$/i.test(trimmed) ? trimmed + '/' : trimmed;
}

/** Resolve a selected resource only for highlighting inside this tree, without listing outside cwd. */
export function workspaceTreeFile(root: string, path: string): string | undefined {
  const absolute = resolveWorkspacePath(root, path).replace(/\\/g, '/');
  const prefix = root.replace(/\/+$/, '') + '/';
  return absolute.startsWith(prefix) &&
    relativeFilePath(absolute.slice(prefix.length)) !== undefined
    ? absolute
    : undefined;
}

export function workspaceTreeAncestors(root: string, file: string | undefined): string[] {
  if (!file) return [];
  const prefix = root.replace(/\/+$/, '') + '/';
  if (!file.startsWith(prefix)) return [];
  return ancestorDirectories(file.slice(prefix.length)).map((path) =>
    resolveWorkspacePath(root, path).replace(/\\/g, '/'),
  );
}
