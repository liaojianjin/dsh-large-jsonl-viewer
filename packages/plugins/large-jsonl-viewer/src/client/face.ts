/** Typed remote vocabulary is generated from the Host controller. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
import type {} from '../../lib/typert.remote-client.js';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { TabState } from './store.ts';
export interface ViewerFace {
  supervise: Context['remote']['$stream'];
  api: Context['remote']['largeJsonl'];
  getState(id: string, signal: AbortSignal): TabState;
  sessionId(address: string): { sessionId: SessionId; path: string };
}
