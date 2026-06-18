import React, { useState, useRef } from 'react';
import { ScheduleData, ScheduleConflict, WishSolution, WishOp, FixItOptions, DEFAULT_FIXIT_OPTIONS } from '../types';
import { AISettings } from './Settings';
import { ClaudeScheduler } from '../claudeScheduler';
import { summarizeFixIt } from '../fixit';
import { wishSolutionToDraft, computeSolutionImpact } from '../wish';
import ImpactSummary from './ImpactSummary';
import TrimPanel from './TrimPanel';

// "Fix It" 🔧 — the compliance-remediation panel that sits at the top of the
// Compliance tab. The BCBA picks which clinical tools the AI may use and which
// clients to leave out, then gets up to 3 proposed solutions to accept, customize
// & accept, object to (regenerate with feedback), or reject as a set.
interface Props {
  data: ScheduleData;
  aiSettings: AISettings;
  conflicts: ScheduleConflict[];
  onAccept: (sol: WishSolution) => void | Promise<void>;
  onCustomize: (sol: WishSolution) => void;
}

const TOGGLES: { key: keyof FixItOptions; label: string }[] = [
  { key: 'includeBtSupervision', label: 'Include BT supervision' },
  { key: 'includeNoBtSupervision', label: 'Include no-BT supervision' },
  { key: 'includeInSessionParentTraining', label: 'Include in-session parent training' },
  { key: 'includeOutSessionParentTraining', label: 'Include out-session parent training' },
  { key: 'includeCasePlanning', label: 'Include case planning' },
  { key: 'softenBillableMinimum', label: 'Soften billable minimum requirement' },
];

const PRIORITY_TOGGLES: { key: keyof FixItOptions; label: string }[] = [
  { key: 'prioritizeBtSupervision', label: 'Prioritize BT supervision' },
  { key: 'prioritizeParentTraining', label: 'Prioritize parent training' },
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

export default function FixItPanel({ data, aiSettings, conflicts, onAccept, onCustomize }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<FixItOptions>({ ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<WishSolution[] | null>(null);
  // "Object": a feedback note folded into a regenerate request.
  const [objecting, setObjecting] = useState(false);
  const [objection, setObjection] = useState('');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [copyFlash, setCopyFlash] = useState(false);
  const [trimSolution, setTrimSolution] = useState<WishSolution | null>(null);
  const previewTextRef = useRef<HTMLTextAreaElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = (key: keyof FixItOptions) =>
    setOptions(o => ({ ...o, [key]: !o[key] }));

  const excluded = new Set(options.excludedClientIds);
  const toggleClient = (id: string) =>
    setOptions(o => {
      const set = new Set(o.excludedClientIds);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...o, excludedClientIds: [...set] };
    });
  const excludeAllClients = () =>
    setOptions(o => ({ ...o, excludedClientIds: data.clients.map(c => c.id) }));
  const includeAllClients = () =>
    setOptions(o => ({ ...o, excludedClientIds: [] }));

  const generate = async (extraNote?: string) => {
    if (!aiSettings.apiKey) { setError('Add your Claude API key in Admin → Settings first.'); return; }
    setLoading(true); setError(null);
    try {
      const conflictMsgs = conflicts.map(c => c.message);
      if (extraNote && extraNote.trim()) conflictMsgs.push(`BCBA feedback on the prior options: ${extraNote.trim()}`);
      const scheduler = new ClaudeScheduler(aiSettings.apiKey, data, aiSettings.model);
      const sols = await scheduler.generateFixSolutions(options, conflictMsgs);
      setSolutions(sols);
      setObjecting(false); setObjection('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const reject = () => { setSolutions(null); setObjecting(false); setObjection(''); };

  const openPromptPreview = () => {
    const scheduler = new ClaudeScheduler(aiSettings.apiKey || 'preview', data, aiSettings.model);
    const text = scheduler.buildFixItPrompt(options, conflicts.map(c => c.message));
    setPreviewPrompt(text);
    setShowPromptPreview(true);
  };

  const anyStrategy = options.includeBtSupervision || options.includeNoBtSupervision
    || options.includeInSessionParentTraining || options.includeOutSessionParentTraining
    || options.includeCasePlanning;

  return (
    <div style={{
      border: '1px solid #fdba74', backgroundColor: '#fff7ed',
      borderRadius: 8, marginBottom: 16, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 15, fontWeight: 700, color: '#9a3412', textAlign: 'left',
        }}
      >
        <span>🔧 Fix It — AI compliance remediation</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>

      {showPromptPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
          <div style={{ background: 'white', borderRadius: 10, padding: 20, width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 15 }}>AI Prompt Preview</strong>
              <button onClick={() => setShowPromptPreview(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <textarea
              ref={previewTextRef}
              readOnly
              value={previewPrompt}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, padding: 10, border: '1px solid #d1d5db', borderRadius: 6, resize: 'none', overflowY: 'auto' }}
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(previewPrompt).catch(() => {});
                setCopyFlash(true);
                if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
                copyTimeoutRef.current = setTimeout(() => setCopyFlash(false), 2000);
              }}
              style={{ marginTop: 10, padding: '7px 14px', background: copyFlash ? '#15803d' : '#ea580c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end', transition: 'background 0.2s' }}
            >{copyFlash ? '✓ Copied!' : 'Copy to clipboard'}</button>
          </div>
        </div>
      )}

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ fontSize: 12, color: '#9a3412', marginTop: 0 }}>
            Pick which clinical tools the AI may use and any clients to leave out,
            then generate up to 3 compliant ways to close your supervision and
            parent-training gaps.
          </p>

          {/* Strategy toggles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, marginBottom: 8 }}>
            {TOGGLES.map(t => (
              <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!options[t.key]} onChange={() => toggle(t.key)} />
                {t.label}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            {PRIORITY_TOGGLES.map(t => (
              <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b21a8', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!options[t.key]} onChange={() => toggle(t.key)} />
                {t.label}
              </label>
            ))}
          </div>

          {/* Client exclusion */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
                Clients to consider ({data.clients.length - excluded.size} of {data.clients.length})
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={excludeAllClients} disabled={excluded.size === data.clients.length} style={{ ...miniBtn, opacity: excluded.size === data.clients.length ? 0.45 : 1 }}>Uncheck all</button>
                <button onClick={includeAllClients} disabled={excluded.size === 0} style={{ ...miniBtn, opacity: excluded.size === 0 ? 0.45 : 1 }}>Check all</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {data.clients.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!excluded.has(c.id)} onChange={() => toggleClient(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
              Checked clients are included; unchecked are left out of the calculation.
            </p>
          </div>

          <div style={{ background: '#ffedd5', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#9a3412', marginBottom: 12 }}>
            <strong>Plan:</strong> {summarizeFixIt(options, data.clients)}
          </div>

          {error && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <button
              onClick={() => generate()}
              disabled={loading || !anyStrategy}
              style={{
                padding: '8px 16px', background: loading || !anyStrategy ? '#fdba74' : '#ea580c', color: 'white',
                border: 'none', borderRadius: 6, cursor: loading || !anyStrategy ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
              }}
            >{loading ? 'Thinking…' : solutions ? 'Regenerate' : 'Generate solutions'}</button>
            <button
              onClick={openPromptPreview}
              title="Preview AI prompt"
              style={{ ...miniBtn, fontSize: 14, padding: '7px 10px' }}
            >🔍</button>
            {!anyStrategy && <span style={{ fontSize: 12, color: '#9a3412', alignSelf: 'center' }}>Select at least one strategy.</span>}
          </div>

          {/* Solutions */}
          {solutions && (
            <div style={{ marginTop: 8 }}>
              {/* If every solution is empty (no-solution diagnostic), show a clear explanation */}
              {solutions.every(s => s.ops.length === 0) ? (
                <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b', marginBottom: 4 }}>
                    No sessions could be placed within your selected strategies
                  </div>
                  {solutions[0]?.reasoning && (
                    <div style={{ fontSize: 12, color: '#7f1d1d', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {solutions[0].reasoning}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 8 }}>
                    Try enabling more strategies, extending the horizon, or reviewing BCBA availability in Settings.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#9a3412', marginBottom: 8 }}>
                    {solutions.filter(s => s.ops.length > 0).length} proposed option{solutions.filter(s => s.ops.length > 0).length === 1 ? '' : 's'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {solutions.filter(s => s.ops.length > 0).map((sol, i) => {
                      const d = wishSolutionToDraft(sol, data);
                      const impact = computeSolutionImpact(data, sol);
                      const addCount = sol.ops.filter(o => o.op === 'add').length;
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
                            <button onClick={() => onAccept(sol)} style={{ padding: '6px 14px', background: '#ea580c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Accept</button>
                            <button onClick={() => onCustomize(sol)} style={{ padding: '6px 14px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Customize &amp; accept</button>
                            {addCount > 0 && (
                              <button
                                onClick={() => setTrimSolution(sol)}
                                style={{ padding: '6px 10px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                                title="Remove individual sessions by clinical priority"
                              >✂️ Trim</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Set-level actions: object (regenerate with feedback) or reject. */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => setObjecting(o => !o)} style={miniBtn}>Object…</button>
                <button onClick={reject} style={{ ...miniBtn, color: '#b91c1c', borderColor: '#fca5a5' }}>Reject these options</button>
              </div>
              {objecting && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    value={objection}
                    onChange={e => setObjection(e.target.value.slice(0, 400))}
                    maxLength={400}
                    rows={2}
                    placeholder="What's wrong with these options? e.g. don't touch Tuesday mornings; prefer adding rather than moving."
                    style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, resize: 'vertical' }}
                  />
                  <span style={{ fontSize: 11, color: objection.length >= 380 ? '#b91c1c' : '#9ca3af', textAlign: 'right' }}>{objection.length}/400</span>
                  <div>
                    <button
                      onClick={() => generate(objection)}
                      disabled={loading || !objection.trim()}
                      style={{
                        padding: '6px 14px', background: loading || !objection.trim() ? '#fdba74' : '#ea580c', color: 'white',
                        border: 'none', borderRadius: 6, cursor: loading || !objection.trim() ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
                      }}
                    >Regenerate with feedback</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {trimSolution && (
        <TrimPanel
          solution={trimSolution}
          data={data}
          onApply={sol => { setTrimSolution(null); onAccept(sol); }}
          onClose={() => setTrimSolution(null)}
        />
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  padding: '5px 10px', background: 'white', color: '#374151',
  border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
