// useSassiSession — the multi-turn state behind the sAssI schedule chat.
//
// Keeps ONE ClaudeScheduler per session so the anonymization map (and thus the
// token history we replay to the API) stays stable across turns. Two transcripts
// are maintained: `messages` (de-anonymized, for the UI) and an internal history
// ref in token space (what actually goes to Claude). A turn's ops REPLACE the
// live draft preview via `onProposal`; an empty-ops turn (a pure "why?" answer)
// leaves the current proposal untouched.

import { useCallback, useRef, useState } from 'react';
// Type-only: the runtime module (which pulls in the Anthropic SDK) is loaded
// lazily inside `send`, so the always-mounted dock doesn't drag it into the
// initial bundle — matching how app.tsx escalates to Claude elsewhere.
import type { ClaudeScheduler, SassiMessage, ClaudeModel } from '../../claudeScheduler';
import type { WishOp, ScheduleData } from '../../types';

export interface SassiUiMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type SassiStatus = 'idle' | 'thinking' | 'error';

export interface SassiSession {
  messages: SassiUiMessage[];
  status: SassiStatus;
  error: string | null;
  /** True once a conversation is underway (drives the dock's chat surface). */
  active: boolean;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

export interface UseSassiSessionParams {
  getSchedule: () => ScheduleData | null;
  apiKey: string;
  model: ClaudeModel;
  /** Replace the live draft preview with the turn's complete proposal. */
  onProposal: (ops: WishOp[]) => void;
}

export function useSassiSession({ getSchedule, apiKey, model, onProposal }: UseSassiSessionParams): SassiSession {
  const [messages, setMessages] = useState<SassiUiMessage[]>([]);
  const [status, setStatus] = useState<SassiStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const schedulerRef = useRef<ClaudeScheduler | null>(null);
  const scheduleRef = useRef<ScheduleData | null>(null);
  const historyRef = useRef<SassiMessage[]>([]);

  const reset = useCallback(() => {
    schedulerRef.current = null;
    scheduleRef.current = null;
    historyRef.current = [];
    setMessages([]);
    setStatus('idle');
    setError(null);
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const data = getSchedule();
    if (!data || !apiKey) {
      setError('Add a Claude API key in Settings to chat with sAssI.');
      setStatus('error');
      return;
    }

    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
    setStatus('thinking');
    setError(null);

    try {
      // (Re)build the session scheduler when it's missing or the base schedule
      // changed underneath us (e.g. after a commit) — a fresh base means a fresh
      // conversation grounded in the new schedule. The module is loaded lazily so
      // the Anthropic SDK stays out of the initial bundle.
      if (!schedulerRef.current || scheduleRef.current !== data) {
        const { ClaudeScheduler } = await import('../../claudeScheduler');
        schedulerRef.current = new ClaudeScheduler(apiKey, data, model);
        scheduleRef.current = data;
        historyRef.current = [];
      }
      const scheduler = schedulerRef.current;
      scheduler.setModel(model);

      const nextHistory: SassiMessage[] = [...historyRef.current, { role: 'user', content: scheduler.scrub(trimmed) }];
      const res = await scheduler.chat(nextHistory);
      historyRef.current = [...nextHistory, { role: 'assistant', content: res.raw }];
      setMessages(prev => [...prev, { role: 'assistant', text: res.reply || '(no reply)' }]);
      // Non-empty ops replace the preview; an explanation-only turn leaves it.
      if (res.ops.length > 0) onProposal(res.ops);
      setStatus('idle');
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus('error');
    }
  }, [getSchedule, apiKey, model, onProposal]);

  return {
    messages,
    status,
    error,
    active: messages.length > 0 || status === 'thinking',
    send,
    reset,
  };
}
