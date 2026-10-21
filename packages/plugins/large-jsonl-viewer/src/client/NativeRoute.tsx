/** A specific native file route when Better Sidebar replaces the text tab. */
import { useEffect, useMemo, useState } from 'react';
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import type { ViewerFace } from './face.ts';
import { JsonlPreview } from './JsonlPreview.tsx';

export const NATIVE_ID = 'dsh-large-jsonl-viewer.native';
export function nativeDefinition(): SidebarRightTabDefinition {
  return {
    id: NATIVE_ID,
    kind: NATIVE_ID,
    patterns: ['dsh-resource://file/**/*.jsonl', 'dsh-resource://file/**/*.ndjson'],
    priority: 'extension',
    canOpen: (address) => parseFileAddress(address)?.scope === 'session',
    title: (address) => parseFileAddress(address)?.path.split('/').pop() || address,
  };
}

export function NativeRoute(
  props: PropsRuntime<'sidebar.right.pane.tab'> & ViewerFace & PropsLocale<'largeJsonl'>,
) {
  const { tab } = props.useTabInfo();
  const [wrap, setWrap] = useState(true),
    [revision, setRevision] = useState(0);
  const content = useMemo(
    () => ({
      kind: 'renderer' as const,
      revision,
      loaded() {},
      failed() {},
      reload: () => setRevision((value) => value + 1),
    }),
    [revision],
  );
  useEffect(() => tab.actions.bindCommands({ refresh: content.reload }), [tab.actions, content]);
  return (
    <div className="jsonl-native-route">
      <div className="jsonl-toolbar">
        <span>{props.t('title')}</span>
        <label>
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />{' '}
          {props.t('wrap')}
        </label>
        <button onClick={content.reload}>{props.t('refresh')}</button>
      </div>
      <JsonlPreview {...props} resourceAddress={tab.contentId} content={content} wrap={wrap} />
    </div>
  );
}
