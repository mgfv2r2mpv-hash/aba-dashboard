import React, { useState } from 'react';
import { ScheduleData, WishRequest, WishKind, WishSolution, WishOp, DayOfWeek, Appointment } from '../types';
import { AISettings } from './Settings';
import { ClaudeScheduler } from '../claudeScheduler';
import { summarizeWish, wishSolutionToDraft } from '../wish';

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
  }
}

export default function WishComposer({ data, aiSettings, onAccept, onCustomize, onClose }: Props) {
  const [wish, setWish] = useState<WishRequest>({ kind: 'vacation', horizonWeeks: 8 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<WishSolution[] | null>(null);

  const upd = (patch: Partial<WishRequest>) => setWish(w => ({ ...w, ...patch }));

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

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
    boxSizing: 'border-box',
  };

  return (
    <div style={overlay}>
      <div style={{ background: 'white', borderRadius: 10, padding: 20, width: '100%', maxWidth: 560, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>✨ Wish It</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
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
              <span title={CONTEXT_TOOLTIP} style={{ cursor: 'help', color: '#6b7280', fontSize: 11, border: '1px solid #d1d5db', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</span>
            </div>
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
            <input type="number" min="1" max="26" value={wish.horizonWeeks ?? 8} onChange={e => upd({ horizonWeeks: Math.max(1, parseInt(e.target.value) || 8) })} style={{ ...inputStyle, width: 70 }} />
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
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 8 }}>
              {solutions.length > 0 ? `${solutions.length} option${solutions.length === 1 ? '' : 's'}` : 'No compliant options found'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {solutions.map((sol, i) => {
                const d = wishSolutionToDraft(sol, data);
                return (
                  <div key={sol.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>Option {i + 1}: {sol.summary}</div>
                    {sol.reasoning && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sol.reasoning}</div>}
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#374151' }}>
                      {sol.ops.map((o, j) => <li key={j}>{opText(o)}</li>)}
                    </ul>
                    {d.unresolved > 0 && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>{d.unresolved} change(s) referenced something not found and will be skipped.</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => onAccept(sol)} style={{ padding: '6px 14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Accept</button>
                      <button onClick={() => onCustomize(sol)} style={{ padding: '6px 14px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Customize</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          <button onClick={generate} disabled={loading} style={{ padding: '8px 16px', background: loading ? '#a78bfa' : '#7c3aed', color: 'white', border: 'none', borderRadius: 6, cursor: loading ? 'default' : 'pointer', fontWeight: 600 }}>
            {loading ? 'Thinking…' : solutions ? 'Regenerate' : 'Generate options'}
          </button>
        </div>
      </div>
    </div>
  );
}
