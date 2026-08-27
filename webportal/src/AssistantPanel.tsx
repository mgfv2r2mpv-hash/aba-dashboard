import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleData, WishOp } from '@shared/types';
import type { ClaudeModel } from '@shared/claudeScheduler';
import { useSassiSession } from '@shared/components/dock/sassiSession';
import { SassiChat } from '@shared/components/dock/SassiChat';
import { buildProposal, type Proposal } from './assistant/proposal';

// The SDK insists on an auth value; the proxy replaces it with the real key before
// the request leaves the server, so what the browser holds is a label, not a secret.
const PROXY_STANDS_IN_FOR_THE_KEY = 'proxied-by-the-portal';

// Same-origin, which is why the portal's CSP stays `connect-src 'self'`.
const proxyBase = (): string => `${window.location.origin}/api/claude`;

/**
 * Ask sAssI - the conversational half of the Build tab. The deterministic builder
 * above it shapes a whole month; this is for the particulars ("move Thursday's
 * supervision earlier", "fill my week to 25 hours"), and for asking why.
 *
 * The anonymizer runs here in the browser, as it always has. What changed is where
 * the request goes: to this site's own /api/claude, which holds the key and screens
 * the payload again, rather than straight to Anthropic with a key the BCBA pasted in.
 */
export default function AssistantPanel({
  data,
  onApply,
}: {
  data: ScheduleData;
  onApply: (next: ScheduleData) => void;
}) {
  const [model, setModel] = useState<ClaudeModel>('claude-sonnet-4-6');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // The hook reads the schedule through a getter so a turn always sees the current
  // one; a ref keeps that getter stable, which keeps `send` stable.
  const dataRef = useRef(data);
  dataRef.current = data;

  const handleProposal = useCallback((ops: WishOp[]) => {
    setProposal(ops.length > 0 ? buildProposal(dataRef.current, ops) : null);
  }, []);

  const session = useSassiSession({
    getSchedule: () => dataRef.current,
    apiKey: PROXY_STANDS_IN_FOR_THE_KEY,
    baseUrl: proxyBase(),
    model,
    onProposal: handleProposal,
    getFocusedAppointmentId: () => null,
  });

  // A proposal describes one exact schedule. Once that schedule changes - the
  // proposal was applied, or the calendar was edited elsewhere - it is about
  // something that no longer exists.
  useEffect(() => { setProposal(null); }, [data]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || session.status === 'thinking') return;
    setDraft('');
    void session.send(text);
  }, [draft, session]);

  const toggleModel = useCallback(() => {
    setModel(m => (m === 'claude-sonnet-4-6' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6'));
  }, []);

  const netLabel = useMemo(() => {
    if (!proposal) return '';
    if (proposal.netSessions > 0) return `${proposal.netSessions} more session${proposal.netSessions === 1 ? '' : 's'}`;
    if (proposal.netSessions < 0) return `${-proposal.netSessions} fewer session${proposal.netSessions === -1 ? '' : 's'}`;
    return 'the same number of sessions';
  }, [proposal]);

  const cases = data.clients.length;

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Ask sAssI</h3>
      <p className="settings-section-desc">
        For the particulars the builder cannot know - move a session, add supervision on a
        specific day, top your week up to a number, or ask why something was placed where it
        was. Names never leave this browser: the assistant sees opaque tokens, and the request
        goes to this site's own server, which holds the key.
      </p>

      {cases === 0 && (
        <p className="build-blocked" role="status">Add at least one case before asking sAssI to change anything.</p>
      )}

      {session.active && (
        <SassiChat
          session={session}
          model={model}
          onToggleModel={toggleModel}
          footnote="A proposal appears below this thread. Read it, then apply or discard it - nothing reaches the calendar on its own."
        />
      )}

      <div className="assistant-ask">
        <textarea
          ref={inputRef}
          className="form-input assistant-input"
          rows={2}
          placeholder="e.g. fill my week to 25 hours, or move Thursday's supervision earlier"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <button className="btn-primary" onClick={submit} disabled={!draft.trim() || session.status === 'thinking'}>
          {session.status === 'thinking' ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {proposal && (
        <div className="assistant-proposal">
          <span className="build-count">
            sAssI proposes {proposal.ops.length} change{proposal.ops.length === 1 ? '' : 's'}, leaving {netLabel}.
          </span>
          <ul className="assistant-op-list">
            {proposal.lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          <div className="build-decision">
            <button className="btn-primary" onClick={() => onApply(proposal.next)}>Apply to the calendar</button>
            <button className="btn-ghost" onClick={() => setProposal(null)}>Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}
