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
import type { ClaudeScheduler, SassiMessage, ClaudeModel, ClarifyOption } from '../../claudeScheduler';
import type { WishOp, ScheduleData } from '../../types';
// Pure scheduling logic (no Anthropic SDK), safe to import eagerly — used to
// render a build's block/metrics readout locally in the transcript.
import { formatBuildSummary } from '../../scheduleBuilder';

export interface SassiUiMessage {
  role: 'user' | 'assistant';
  text: string;
  // Present on a clarify turn (from Claude) or a local disambiguation — render as
  // tappable chips; tapping one calls send(option.value).
  questions?: ClarifyOption[];
}

// Replace a resolved shorthand ("SB") with the chosen client's full name, matched
// as a standalone token (letters on either side excluded) so it can't corrupt a
// longer word. The full name is tokenized by scrub() on the resend.
function substituteRef(text: string, ref: string, name: string): string {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(^|[^A-Za-z])${escaped}(?![A-Za-z])`, 'g'), (_m, pre) => `${pre}${name}`);
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
  /** The selected appointment's id (or null), for deictic "this appointment". */
  getFocusedAppointmentId: () => string | null;
}

export function useSassiSession({ getSchedule, apiKey, model, onProposal, getFocusedAppointmentId }: UseSassiSessionParams): SassiSession {
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

      // Resolve short client references ("SB" → a client) LOCALLY, before scrub, so
      // shorthands become tokens too. An ambiguous reference is answered with chips
      // right here (no Claude call); the unambiguous case is normalized to the full
      // name, which scrub() then tokenizes (scrub covers names + name components,
      // and chat() re-asserts fail-closed before anything leaves the device).
      const resolved = scheduler.resolveEntities(trimmed);
      if (resolved.ambiguities.length > 0) {
        const amb = resolved.ambiguities[0];
        const options: ClarifyOption[] = amb.candidates.map(c => ({
          label: c.name,
          value: substituteRef(trimmed, amb.ref, c.name),
        }));
        setMessages(prev => [...prev, { role: 'assistant', text: `Which one is “${amb.ref}”?`, questions: options }]);
        setStatus('idle');
        return;
      }

      // Deictic "this appointment": attach the focused session's token to the
      // UNCACHED tail (this outgoing user message), never the cached system block —
      // otherwise a selection change would bust the prefix cache every turn.
      const focusId = getFocusedAppointmentId();
      const focusTok = focusId ? scheduler.aptToken(focusId) : null;
      let userContent = scheduler.scrub(resolved.text);
      if (focusTok) userContent += `\n[context: this appointment = ${focusTok}]`;

      const nextHistory: SassiMessage[] = [...historyRef.current, { role: 'user', content: userContent }];
      const res = await scheduler.chat(nextHistory);

      // Build turn: Claude only routed the intent — the deterministic engine places
      // locally. Stage its ops (same path as any proposal) and print its block/
      // metrics readout in the transcript. The summary carries REAL client names, so
      // it goes to the UI ONLY — history keeps res.raw (token space) so no name ever
      // rides back to the API on the next turn.
      if (res.build) {
        const result = scheduler.runBuild(new Date(), res.buildScope ?? 'all');
        const staged = result.solution.ops.length > 0;
        // A build REPLACES the live preview even when it placed nothing — same as the
        // deterministic button (handleBuildDirect) — so a 0-op build clears any stale
        // proposal from an earlier turn instead of leaving it to be accepted by mistake.
        onProposal(result.solution.ops);
        historyRef.current = [...nextHistory, { role: 'assistant', content: res.raw }];
        const summary = formatBuildSummary(result, staged);
        setMessages(prev => [...prev, { role: 'assistant', text: res.reply ? `${res.reply}\n\n${summary}` : summary }]);
        setStatus('idle');
        return;
      }

      historyRef.current = [...nextHistory, { role: 'assistant', content: res.raw }];
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: res.reply || (res.questions?.length ? '' : '(no reply)'),
        questions: res.questions,
      }]);
      // Non-empty ops replace the preview; an explanation/clarify turn leaves it.
      if (res.ops.length > 0) onProposal(res.ops);
      setStatus('idle');
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus('error');
    }
  }, [getSchedule, apiKey, model, onProposal, getFocusedAppointmentId]);

  return {
    messages,
    status,
    error,
    active: messages.length > 0 || status === 'thinking',
    send,
    reset,
  };
}
