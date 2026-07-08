import React, { useState } from 'react';
import { ScheduleData, WishRequest, WishKind, WishSolution, WishOp, DayOfWeek, Appointment } from '../types';
import { AISettings } from './Settings';
import { ClaudeScheduler } from '../claudeScheduler';
import { summarizeWish, wishSolutionToDraft, computeSolutionImpact } from '../wish';
import ImpactSummary from './ImpactSummary';
import TrimPanel from './TrimPanel';
import { solveComplianceFill } from '../localSolver';
import { monthPeriod } from '../compliance';
import { copyToClipboard } from '../lib/clipboard';

// "Wish It": a structured natural-language composer that asks the AI for up to 3
// ways to reshape the schedule toward a goal, then lets the BCBA Accept (apply),
// Customize (load into the editable draft), or Cancel. Accept/Customize are
// delegated to the parent so they reuse the app's commit/stage plumbing.
interface Props {
  data: ScheduleData;
  aiSettings: AISettings;
  onAccept: (sol: WishSolution) => void | Promise<void>;
  onCustomize: (sol: WishSolution) => void;
  onClose: () => void;
}

const KINDS: { value: WishKind; label: string; blurb: string }[] = [
  { value: 'vacation', label: 'Plan time away', blurb: 'Block a date range and reschedule my sessions around it.' },
  { value: 'clearWindow', label: 'Clear a recurring window', blurb: 'Free up a weekday/time going forward (e.g. Friday evenings).' },
  { value: 'addRecurring', label: 'Add a recurring session', blurb: 'Fit a new repeating session into a tight schedule.' },
  { value: 'shaveDown', label: 'Trim over-served sessions', blurb: 'Shave supervision hours toward the minimum to free up capacity.' },
  { value: 'fillSchedule', label: 'Fill my schedule out', blurb: 'Add supervision and parent-training within existing direct sessions to bring cases toward the ideal compliance range this month. PT only inside a running direct session. Does not move existing sessions.' },
  { value: 'maximizeDirectHours', label: 'Maximize direct hours across cases', blurb: 'Fill each case\'s authorized weekly direct-service hours toward 100% using open availability windows. Leaves my BCBA schedule alone.' },
  { value: 'freeform', label: 'Something else', blurb: 'Describe it in your own words.' },
];

const CONTEXT_TOOLTIP = `Be specific: mention affected clients by name, days to avoid, session types to add or remove, and any hard constraints (e.g. "keep Tuesday 9–11 free"). The more detail, the better the AI result.`;
const WEEKDAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const APPT_TYPES: { v: Appointment['type']; l: string }[] = [
  { v: 'parent-training', l: 'Parent Training' }, { v: 'supervision', l: 'Supervision' },
  { v: 'case-planning', l: 'Case Planning' }, { v: 'client-session', l: 'Client Session' },
  { v: 'reassessment', l: 'Reassessment' }, { v: 'other', l: 'Other' },
];

const inputStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#374151' };

function opText(o: WishOp): string {
  const t = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  switch (o.op) {
    case 'move': return `Move ${o.appointmentId.slice(0, 6)} → ${t(o.start)}–${t(o.end)}`;
    case 'remove': return `Remove ${o.appointmentId.slice(0, 6)}`;
    case 'add': return `Add ${o.title || o.type}${o.client ? ` for ${o.client}` : ''} ${t(o.start)}${o.recurring ? ` (${o.pattern || 'weekly'})` : ''}`;
    case 'blackout': return `Block ${o.entity} on ${o.date}${o.reason ? ` — ${o.reason}` : ''}`;
    case 'setFixed': return `${o.isFixed ? 'Lock' : 'Unlock'} ${o.appointmentId.slice(0, 6)}`;
    case 'complete': return `Complete ${o.appointmentId.slice(0, 6)}`;
    case 'cancel': return `Cancel ${o.appointmentId.slice(0, 6)}${o.reason ? ` (${o.reason})` : ''}`;
    case 'regroup': return `Group ${o.appointmentIds.length} sessions into a ${o.recurringPattern || 'recurring'} series`;
    case 'setHint': return `Remember a scheduling preference for ${o.client}`;
  }
}

const DEFAULT_HORIZON = 4;

export default function WishComposer({ data, aiSettings, onAccept, onCustomize, onClose }: Props) {
  const [wish, setWish] = useState<WishRequest>({ kind: 'vacation', horizonWeeks: DEFAULT_HORIZON });
  const [horizonText, setHorizonText] = useState(String(DEFAULT_HORIZON));
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<WishSolution[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [trimSolution, setTrimSolution] = useState<WishSolution | null>(null);

  const upd = (patch: Partial<WishRequest>) => setWish(w => ({ ...w, ...patch }));

  const copyPrompt = async () => {
    try {
      const scheduler = new ClaudeScheduler(aiSettings.apiKey || 'preview', data, aiSettings.model);
      const prompt = scheduler.buildWishPrompt(wish);
      const ok = await copyToClipboard(prompt);
    if (!ok) throw new Error('Copy failed');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy prompt to clipboard.');
    }
  };

  const generate = async () => {
    if (!aiSettings.apiKey) { setError('Add your Claude API key in Settings first.'); return; }
    setLoading(true); setError(null); setSolutions(null);
    try {
      const scheduler = new ClaudeScheduler(aiSettings.apiKey, data, aiSettings.model);
      const sols = await scheduler.generateWishSolutions(wish);
      setSolutions(sols);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const quickFill = () => {
    setError(null); setSolutions(null);
    try {
      const result = solveComplianceFill(data, monthPeriod(new Date()), new Date());
      const detail = result.casesHelped > 0
        ? `${result.casesHelped}/${result.totalCases} cases helped · +${result.supHoursAdded.toFixed(1)}h supervision`
        : '';
      setSolutions([{
        ...result.solution,
        summary: result.solution.summary + (detail ? ` (${detail})` : ''),
      }]);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 6 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>✨ Wish It</h2>
      </div>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          Describe a goal; the AI proposes up to 3 compliant ways to reshape your schedule. Pick one to apply or customize.
        </p>

        {/* Composer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            What do you want to do?
            <select value={wish.kind} onChange={e => setWish({ kind: e.target.value as WishKind, horizonWeeks: wish.horizonWeeks })} style={inputStyle}>
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <span style={{ fontWeight: 400, color: '#6b7280' }}>{KINDS.find(k => k.value === wish.kind)?.blurb}</span>
          </label>

          {wish.kind === 'vacation' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...labelStyle, flex: '1 1 150px' }}>From<input type="date" value={wish.dateStart || ''} onChange={e => upd({ dateStart: e.target.value })} style={inputStyle} /></label>
              <label style={{ ...labelStyle, flex: '1 1 150px' }}>To<input type="date" value={wish.dateEnd || ''} onChange={e => upd({ dateEnd: e.target.value })} style={inputStyle} /></label>
            </div>
          )}

          {(wish.kind === 'clearWindow' || wish.kind === 'addRecurring') && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...labelStyle, flex: '1 1 120px' }}>Day
                <select value={wish.weekday || 'Friday'} onChange={e => upd({ weekday: e.target.value as DayOfWeek })} style={inputStyle}>
                  {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: '1 1 100px' }}>{wish.kind === 'addRecurring' ? 'Around' : 'From'}<input type="time" value={wish.windowStart || ''} onChange={e => upd({ windowStart: e.target.value })} style={inputStyle} /></label>
              {wish.kind === 'clearWindow' && (
                <label style={{ ...labelStyle, flex: '1 1 100px' }}>To<input type="time" value={wish.windowEnd || ''} onChange={e => upd({ windowEnd: e.target.value })} style={inputStyle} /></label>
              )}
            </div>
          )}

          {wish.kind === 'clearWindow' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
              <input type="checkbox" checked={!!wish.everyOtherWeek} onChange={e => upd({ everyOtherWeek: e.target.checked })} />
              Every other week (e.g. custody Fridays)
            </label>
          )}

          {wish.kind === 'addRecurring' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...labelStyle, flex: '1 1 150px' }}>Type
                <select value={wish.newType || 'parent-training'} onChange={e => upd({ newType: e.target.value as Appointment['type'] })} style={inputStyle}>
                  {APPT_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: '1 1 150px' }}>Client (optional)
                <select value={wish.client || ''} onChange={e => upd({ client: e.target.value || undefined })} style={inputStyle}>
                  <option value="">— none —</option>
                  {data.clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: '1 1 100px' }}>Minutes<input type="number" min="15" step="15" value={wish.durationMins ?? 60} onChange={e => upd({ durationMins: parseInt(e.target.value) || 60 })} style={inputStyle} /></label>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#374151' }}>
              <span>{wish.kind === 'freeform' ? 'Describe your goal' : 'Anything else? (optional)'}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={() => setTooltipVisible(v => !v)}
                onKeyDown={e => e.key === 'Enter' && setTooltipVisible(v => !v)}
                style={{ cursor: 'pointer', color: '#6b7280', fontSize: 11, border: '1px solid #d1d5db', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, userSelect: 'none' }}
              >?</span>
            </div>
            {tooltipVisible && (
              <div style={{ fontSize: 12, color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 }}>
                {CONTEXT_TOOLTIP}
              </div>
            )}
            <textarea
              value={wish.note || ''} onChange={e => upd({ note: e.target.value.slice(0, 400) })}
              rows={wish.kind === 'freeform' ? 3 : 2} maxLength={400}
              placeholder={wish.kind === 'freeform' ? 'e.g. end by 4pm on Wednesdays, and keep a 12–1 lunch hole daily' : 'extra detail to guide the AI'}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <span style={{ fontSize: 11, color: (wish.note?.length ?? 0) >= 380 ? '#b91c1c' : '#9ca3af', textAlign: 'right' }}>{wish.note?.length ?? 0}/400</span>
          </div>

          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            Look ahead
            <input
              type="number"
              min="1"
              max="26"
              value={horizonText}
              onChange={e => {
                setHorizonText(e.target.value);
                const n = parseInt(e.target.value);
                if (!isNaN(n) && n >= 1) upd({ horizonWeeks: Math.min(26, n) });
              }}
              onBlur={() => {
                const n = parseInt(horizonText);
                const clamped = isNaN(n) || n < 1 ? DEFAULT_HORIZON : Math.min(26, n);
                setHorizonText(String(clamped));
                upd({ horizonWeeks: clamped });
              }}
              style={{ ...inputStyle, width: 70 }}
            />
            weeks
          </label>

          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#5b21b6' }}>
            <strong>Wish:</strong> {summarizeWish(wish)}
          </div>
        </div>

        {error && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{error}</div>}

        {/* Options */}
        {solutions && (
          <div style={{ marginTop: 16 }}>
            {solutions.every(s => s.ops.length === 0) ? (
              <div style={{ border: '1px solid #c4b5fd', background: '#f5f3ff', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#5b21b6', marginBottom: 4 }}>
                  No sessions could be placed
                </div>
                {solutions[0]?.reasoning && (
                  <div style={{ fontSize: 12, color: '#4c1d95', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {solutions[0].reasoning}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 8 }}>
                  Try a different wish type or check BCBA availability in Settings.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 8 }}>
                  {solutions.filter(s => s.ops.length > 0).length} option{solutions.filter(s => s.ops.length > 0).length === 1 ? '' : 's'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {solutions.filter(s => s.ops.length > 0).map((sol, i) => {
                    const d = wishSolutionToDraft(sol, data);
                    const impact = computeSolutionImpact(data, sol);
                    const addCount = sol.ops.filter(o => o.op === 'add').length;
                    return (
                      <div key={sol.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>Option {i + 1}: {sol.summary}</div>
                        {sol.reasoning && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sol.reasoning}</div>}
                        <ImpactSummary impact={impact} />
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#374151' }}>
                          {sol.ops.map((o, j) => <li key={j}>{opText(o)}</li>)}
                        </ul>
                        {d.unresolved > 0 && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>{d.unresolved} change(s) referenced something not found and will be skipped.</div>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <button onClick={() => onAccept(sol)} style={{ padding: '6px 14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Accept</button>
                          <button onClick={() => onCustomize(sol)} style={{ padding: '6px 14px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Customize</button>
                          {addCount > 0 && (
                            <button
                              onClick={() => setTrimSolution(sol)}
                              style={{ padding: '6px 10px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                              title="Remove sessions by clinical priority"
                            >✂️ Trim</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={quickFill}
              disabled={loading}
              title="Instantly fill supervision gaps using local rules — no API key needed"
              style={{ padding: '8px 14px', background: 'white', color: '#059669', border: '1px solid #6ee7b7', borderRadius: 6, cursor: loading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}
            >⚡ Quick Fill</button>
            <button
              onClick={copyPrompt}
              title="Copy the prompt that will be sent to Claude"
              style={{ padding: '8px 14px', background: 'white', color: copied ? '#059669' : '#374151', border: `1px solid ${copied ? '#6ee7b7' : '#d1d5db'}`, borderRadius: 6, cursor: 'pointer', fontSize: 13, transition: 'all 0.15s' }}
            >{copied ? '✓ Copied' : '⎘ Copy prompt'}</button>
            <button onClick={generate} disabled={loading} style={{ padding: '8px 16px', background: loading ? '#a78bfa' : '#7c3aed', color: 'white', border: 'none', borderRadius: 6, cursor: loading ? 'default' : 'pointer', fontWeight: 600 }}>
              {loading ? 'Thinking…' : solutions ? 'Regenerate' : 'Generate options'}
            </button>
          </div>
        </div>

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
