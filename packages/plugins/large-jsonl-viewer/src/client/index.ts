/** Register the generated Remote contribution and native renderer as reversible effects. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import contribution from '../../lib/typert.remote-client.js';
import type { ViewerFace } from './face.ts';
import { JsonlPreview } from './JsonlPreview.tsx';
import { createTabStore } from './store.ts';
import { en, zh, type Key } from './locales.ts';
import editorWorkerSource from 'monaco-worker-source';
import { nativeDefinition, NATIVE_ID, NativeRoute } from './NativeRoute.tsx';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import './style.css';
declare module '@deepseek-ai/cordis' {
  interface Context {
    betterSidebar: object;
  }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    largeJsonl: Key;
  }
}
export const inject = ['remote', 'slots', 'locale', 'documentPreviews', 'uiSession'];
/** Mount before registering the caller, so it never waits on its own namespace. */
export function apply(ctx: Context): void {
  const store = createTabStore(),
    workers = new Set<Worker>();
  const global = globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker(...args: unknown[]): Worker };
  };
  const previous = global.MonacoEnvironment;
  const url = URL.createObjectURL(new Blob([editorWorkerSource], { type: 'text/javascript' }));
  global.MonacoEnvironment = {
    getWorker() {
      const worker = new Worker(url, { name: 'jsonl-editor' });
      workers.add(worker);
      return worker;
    },
  };
  ctx.effect(() => () => {
    store.dispose();
    for (const worker of workers) worker.terminate();
    URL.revokeObjectURL(url);
    global.MonacoEnvironment = previous;
  });
  ctx.effect(() => ctx.locale.register('largeJsonl', { en, zh }));
  const t = ctx.locale.bind('largeJsonl');
  ctx.effect(() => ctx.remote.$mount(contribution));
  ctx.inject(['remote.largeJsonl', 'remote.workspaceFiles'], (scope) => {
    const face = (): ViewerFace => ({
      api: scope.remote.largeJsonl,
      files: scope.remote.workspaceFiles,
      browser: store.browser,
      supervise: (options) => scope.remote.$stream(options),
      getState: store.get,
      sessionId(address: string) {
        const file = parseFileAddress(address);
        if (file?.scope !== 'session') throw new Error('A Session file address is required');
        return { sessionId: file.sessionId as SessionId, path: file.path };
      },
    });
    // Optional public service detection: never replace or disable Better Sidebar.
    scope.inject(['betterSidebar', 'sidebarRightTabs'], (native) => {
      native.effect(() => native.sidebarRightTabs.register(nativeDefinition()));
      native.effect(() =>
        native.slots.inject('sidebar.right.pane.tab', () =>
          native.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: NATIVE_ID,
              locale: 'largeJsonl',
              inject: face,
            },
            NativeRoute,
          ),
        ),
      );
    });
    scope.effect(() =>
      scope.documentPreviews.register({
        id: 'dsh-large-jsonl-viewer',
        extensions: ['jsonl', 'ndjson'],
        priority: 'extension',
        title: () => t('title'),
        loading: 'renderer',
        wrap: true,
      }),
    );
    scope.effect(() =>
      scope.slots.inject('sidebar.right.tab.document', () =>
        scope.slots.register(
          {
            name: 'sidebar.right.tab.document',
            key: 'dsh-large-jsonl-viewer',
            locale: 'largeJsonl',
            inject: face,
          },
          JsonlPreview,
        ),
      ),
    );
  });
}
