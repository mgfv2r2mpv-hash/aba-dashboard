import { useEffect, useRef } from 'react';
import { SAssiWord } from '../shell/SAssiMark';
import type { SassiSession } from './sassiSession';
import type { ClaudeModel } from '../../claudeScheduler';

/**
 * SassiChat — the back-and-forth surface of sAssI. Renders the conversation
 * thread; the proposal it stages previews live on the calendar and in the draft
 * tray above (grade + Accept), so this panel stays focused on the dialogue: what
 * changed, why, and the BCBA's particulars. The wish input in the dock footer
 * feeds `session.send`. Header carries the green sAssI wordmark (the AI signal).
 */
export interface SassiChatProps {
  session: SassiSession;
  model: ClaudeModel;
  onToggleModel: () => void;
}

const MODEL_LABEL: Record<string, string> = {
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5-20251001': 'Haiku',
  'claude-opus-4-8': 'Opus',
};

export function SassiChat({ session, model, onToggleModel }: SassiChatProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [session.messages.length, session.status]);

  return (
    <section aria-label="sAssI schedule chat" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
          <SAssiWord ai />
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>schedule chat</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onToggleModel}
          title="Switch model (cost vs reasoning)"
          style={{
            border: '1px solid var(--sage-200)', background: 'var(--sage-50)', borderRadius: 'var(--radius-pill)',
            padding: '2px 9px', fontSize: 11, fontWeight: 700, color: 'var(--sage-700)', cursor: 'pointer',
          }}
        >
          {MODEL_LABEL[model] ?? model}
        </button>
        <button
          type="button"
          onClick={session.reset}
          aria-label="Clear chat"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 2 }}>
        {session.messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {m.text && (
              <div
                style={{
                  fontSize: 12.5, lineHeight: 1.5, padding: '8px 11px', borderRadius: 12, whiteSpace: 'pre-wrap',
                  background: m.role === 'user' ? 'var(--sage-600)' : 'var(--sage-50)',
                  color: m.role === 'user' ? 'var(--white)' : 'var(--text-primary)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--sage-100)',
                  borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                  borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
                }}
              >
                {m.text}
              </div>
            )}
            {m.questions && m.questions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {m.questions.map((q, qi) => (
                  <button
                    key={qi}
                    type="button"
                    onClick={() => session.send(q.value)}
                    disabled={session.status === 'thinking'}
                    style={{
                      border: '1px solid var(--sage-200)', background: 'var(--sage-50)', borderRadius: 'var(--radius-pill)',
                      padding: '5px 11px', fontSize: 12, fontWeight: 700, color: 'var(--sage-700)',
                      cursor: session.status === 'thinking' ? 'default' : 'pointer',
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {session.status === 'thinking' && (
          <div style={{ alignSelf: 'flex-start', fontSize: 12.5, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            sAssI is thinking…
          </div>
        )}
        {session.status === 'error' && session.error && (
          <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--red-700)' }}>{session.error}</div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
        Proposed sessions preview on your calendar and in the tray above — check the grade, then Accept there. Ask “why” anytime.
      </div>
    </section>
  );
}
