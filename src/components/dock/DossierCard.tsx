import { Button } from '../ui';
import type { Dossier, DossierSeverity } from '../../dossier';

/**
 * DossierCard — the "doctor my schedule with me" analysis. Renders a local,
 * AI-free read of what's wrong with whatever the BCBA is looking at: a headline,
 * a worst-first list of findings, then the hand-off. "Fix pace with SAssi" seeds
 * the existing meet-pace solve for the case; "Ask SAssi to dig in" (key only)
 * opens the chat so it can narrate and propose. The facts are always honest even
 * with no key — that's the whole point of computing them on-device.
 */
export interface DossierCardProps {
  dossier: Dossier;
  /** Whether a Claude key is present — gates the conversational "dig in" CTA. */
  aiEnabled: boolean;
  /** Seed the meet-pace solve for this case. */
  onFixPace?: (clientId: string) => void;
  /** Hand the case off to the sAssI chat for narration + proposals. */
  onAskAboutFocus?: () => void;
  onClear: () => void;
}

const DOT: Record<DossierSeverity, string> = {
  red: 'var(--status-behind)',
  yellow: 'var(--status-over)',
  info: '#9ca3af',
};

export function DossierCard({ dossier, aiEnabled, onFixPace, onAskAboutFocus, onClear }: DossierCardProps) {
  const { focusLabel, headline, findings, clientId } = dossier;
  const clean = findings.length === 0;

  return (
    <section
      aria-label="Schedule analysis"
      style={{
        border: '1px solid var(--sage-200)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--white)',
        boxShadow: 'var(--shadow-sm)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--sage-700)' }}>
            Diagnosis
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {focusLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear analysis"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </header>

      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: clean ? 'var(--sage-700)' : 'var(--text-secondary)' }}>
        {headline}
      </p>

      {findings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {findings.map((f, i) => (
            <li key={i} style={{ display: 'flex', gap: 8 }}>
              <span aria-hidden style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 4, background: DOT[f.severity], marginTop: 5 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>{f.title}</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{f.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(clientId && onFixPace && !clean) || (aiEnabled && onAskAboutFocus) ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {clientId && onFixPace && !clean && (
            <Button variant="sassi" size="sm" onClick={() => onFixPace(clientId)}>
              Fix pace with SAssi
            </Button>
          )}
          {aiEnabled && onAskAboutFocus && (
            <Button variant="ghost" size="sm" onClick={onAskAboutFocus}>
              Ask SAssi to dig in
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
