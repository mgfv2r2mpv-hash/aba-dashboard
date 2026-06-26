import React, { useMemo, useState } from 'react';
import { ScheduleData, ScheduleConflict, WishSolution, WishOp, FixItOptions, DEFAULT_FIXIT_OPTIONS } from '../types';
import { AISettings } from './Settings';
import { ClaudeScheduler } from '../claudeScheduler';
import { analyzeCorrections } from '../corrections';
import { wishSolutionToDraft, computeSolutionImpact } from '../wish';
import ImpactSummary from './ImpactSummary';

// Per-case "Fix it" — opened from a row on the Cases table. Two paths:
//   1. In-system — the deterministic corrections engine: what's short, plus the
//      concrete open windows (client + BT + BCBA all free) to enter manually.
//   2. Ask AI — the focused Fix-It prompt (scoped to this one case) with optional
//      free-text guidance, returning solutions to Accept or Customize.
// The director / out-of-system override is deferred (Phase 3 scope note).
interface Props {
  data: ScheduleData;
  clientId: string;
  clientName: string;
  conflicts: ScheduleConflict[];
  aiSettings: AISettings;
  now?: Date;
  onAccept: (sol: WishSolution) => void | Promise<void>;
  onCustomize: (sol: WishSolution) => void;
  onClose: () => void;
}

const TOGGLES: { key: keyof FixItOptions; label: string }[] = [
  { key: 'includeBtSupervision', label: 'BT supervision' },
  { key: 'includeNoBtSupervision', label: 'No-BT supervision' },
  { key: 'includeInSessionParentTraining', label: 'In-session parent training' },
  { key: 'includeOutSessionParentTraining', label: 'Out-session parent training' },
  { key: 'includeCasePlanning', label: 'Case planning' },
  { key: 'softenBillableMinimum', label: 'Soften billable minimum' },
];

function opText(o: WishOp): string {
  const t = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  switch (o.op) {
    case 'move': return `Move ${o.appointmentId.slice(0, 6)} → ${t(o.start)}–${t(o.end)}`;
    case 'remove': return `Remove ${o.appointmentId.slice(0, 6)}`;
    case 'add': return `Add ${o.title || o.type}${o.client ? ` for ${o.client}` : ''} ${t(o.start)}${o.recurring ? ` (${o.pattern || 'weekly'})` : ''}`;
    case 'blackout': return `Block ${o.entity} on ${o.date}${o.reason ? ` — ${o.reason}` : ''}`;
  }
}

export default function CaseFixItDialog({ data, clientId, clientName, conflicts, aiSettings, now = new Date(), onAccept, onCustomize, onClose }: Props) {
  const [options, setOptions] = useState<FixItOptions>({ ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: [], focusClientId: clientId });
  const [guidance, setGuidance] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<WishSolution[] | null>(null);

  // Deterministic in-system view for this case.
  const { needs, flags } = useMemo(() => {
    const report = analyzeCorrections(data, now);
    return {
      needs: report.needs.filter(n => n.clientId === clientId),
      flags: report.flags.filter(f => f.clientId === clientId),
    };
  }, [data, now, clientId]);

  const toggle = (key: keyof FixItOptions) => setOptions(o => ({ ...o, [key]: !o[key] }));
  const anyStrategy = options.includeBtSupervision || options.includeNoBtSupervision
    || options.includeInSessionParentTraining || options.includeOutSessionParentTraining
    || options.includeCasePlanning;

  const generate = async () => {
    if (!aiSettings.apiKey) { setError('Add your Claude API key in Admin → Settings first.'); return; }
    setLoading(true); setError(null);
    try {
      const scheduler = new ClaudeScheduler(aiSettings.apiKey, data, aiSettings.model);
      const sols = await scheduler.generateFixSolutions(
        { ...options, focusClientId: clientId, guidance: guidance.trim() || undefined },
        conflicts.map(c => c.message),
      );
      setSolutions(sols);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>🔧 Fix it — {clientName}</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* 1 — In-system */}
        <Section title="What's short (in-system)">
          {needs.length === 0 ? (
            <p style={{ fontSize: 13, color: '#15803d', margin: 0 }}>Nothing flagged for this case — floors met and targets on pace.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {needs.map((n, i) => (
                <li key={i} style={{ color: n.priority === 1 ? '#b91c1c' : n.priority === 2 ? '#b45309' : '#374151', marginBottom: 3 }}>
                  {n.detail}{n.note ? <span style={{ color: '#2563eb' }}> — {n.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {flags.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Open windows to enter manually</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#92400e' }}>
                {flags.map((f, i) => <li key={i} style={{ marginBottom: 3 }}>{f.message}</li>)}
              </ul>
            </div>
          )}
        </Section>

        {/* 2 — Ask AI */}
        <Section title="Ask AI to resolve">
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>
            Scoped to this case only. Pick which clinical tools the AI may use, add any guidance, then generate compliant options.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 6, marginBottom: 8 }}>
            {TOGGLES.map(t => (
              <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!options[t.key]} onChange={() => toggle(t.key)} />
                {t.label}
              </label>
            ))}
          </div>
          <textarea
            value={guidance}
            onChange={e => setGuidance(e.target.value.slice(0, 400))}
            maxLength={400}
            rows={2}
            placeholder="Optional guidance — e.g. prioritize parent training; keep Tuesday mornings free; the family can only meet after 3pm."
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, resize: 'vertical' }}
          />
          <div style={{ fontSize: 11, color: guidance.length >= 380 ? '#b91c1c' : '#9ca3af', textAlign: 'right' }}>{guidance.length}/400</div>

          {error && <div style={{ color: '#b91c1c', fontSize: 13, margin: '6px 0' }}>{error}</div>}

          <button
            onClick={generate}
            disabled={loading || !anyStrategy}
            style={{
              padding: '8px 16px', background: loading || !anyStrategy ? '#fdba74' : '#ea580c', color: 'white',
              border: 'none', borderRadius: 6, cursor: loading || !anyStrategy ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
            }}
          >{loading ? 'Thinking…' : solutions ? 'Regenerate' : 'Generate solutions'}</button>
          {!anyStrategy && <span style={{ fontSize: 12, color: '#9a3412', marginLeft: 10 }}>Select at least one strategy.</span>}
        </Section>

        {/* Solutions */}
        {solutions && (
          solutions.every(s => s.ops.length === 0) ? (
            <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b', marginBottom: 4 }}>No sessions could be placed within your selected strategies</div>
              {solutions[0]?.reasoning && <div style={{ fontSize: 12, color: '#7f1d1d', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{solutions[0].reasoning}</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {solutions.filter(s => s.ops.length > 0).map((sol, i) => {
                const d = wishSolutionToDraft(sol, data);
                const impact = computeSolutionImpact(data, sol);
                return (
                  <div key={sol.id} style={{ border: '1px solid #fed7aa', background: 'white', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>Option {i + 1}: {sol.summary}</div>
                    {sol.reasoning && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sol.reasoning}</div>}
                    <ImpactSummary impact={impact} />
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#374151' }}>
                      {sol.ops.map((o, j) => <li key={j}>{opText(o)}</li>)}
                    </ul>
                    {d.unresolved > 0 && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>{d.unresolved} change(s) referenced something not found and will be skipped.</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => { onAccept(sol); onClose(); }} style={{ padding: '6px 14px', background: '#ea580c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Accept</button>
                      <button onClick={() => { onCustomize(sol); onClose(); }} style={{ padding: '6px 14px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Customize &amp; accept</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12, marginTop: 12 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: '#374151' }}>{title}</h3>
      {children}
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))', boxSizing: 'border-box',
};
const modal: React.CSSProperties = {
  background: 'white', borderRadius: 10, maxWidth: 620, width: '100%', maxHeight: '100%',
  overflow: 'auto', padding: 18, boxSizing: 'border-box',
};
