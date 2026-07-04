import { useEffect, useRef, useState, CSSProperties } from 'react';
import type { ScheduleData } from '../types';
import { computeHomeTrends, PersonTrend, TrendWindow, TrendStatus } from '../caseModel';
import { Avatar, Button, Input, SegmentedControl, StatusPill } from './ui';
import type { HomeTodo, NewHomeTodo } from '../hooks/useHomeTodos';

// HomeView — the practice-manager start screen. A start-here ritual card, per-
// person trend cards (pace vs actual vs projection from real appointment data),
// and a client-tagged to-dos card that can spawn calendar sessions. All copy is
// sentence-case, even-toned, and PHI-free.

export type RitualKey = 'sunday' | 'midweek' | 'friday';
export type RitualAction = 'assistant' | 'week' | 'todos' | 'home';

export interface HomeViewProps {
  data: ScheduleData;
  now?: Date;
  conflictCount: number;
  complianceFlagCount: number;
  todos: HomeTodo[];
  onAddTodo: (todo: NewHomeTodo) => void;
  onStartSession: (todo: HomeTodo) => void;
  onGo: (action: RitualAction) => void;
}

const STATUS_COLOR: Record<TrendStatus, string> = {
  met: 'var(--status-met)',
  pace: 'var(--status-pace)',
  behind: 'var(--status-behind)',
  over: 'var(--status-over)',
};

const STATUS_BG: Record<TrendStatus, string> = {
  met: 'var(--status-met-bg)',
  pace: 'var(--status-pace-bg)',
  behind: 'var(--status-behind-bg)',
  over: 'var(--status-over-bg)',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── Trend sparkline: dashed pace · dotted projection · solid actual + dot,
//    over a dated x-axis with drop-dots from each delivered day to the axis ────
function Trend({ w }: { w: TrendWindow }) {
  const W = 140, PLOT_H = 40, P = 3;
  const { pace, actual, proj, labels } = w.series;
  const n = Math.max(pace.length - 1, 1);
  const max = Math.max(...pace, ...proj, ...actual, 0.001) * 1.08;
  const AXIS_Y = PLOT_H - P;
  const H = AXIS_Y + 12;              // room for the axis + a label band
  const x = (i: number) => P + (i / n) * (W - 2 * P);
  const y = (v: number) => AXIS_Y - (v / max) * (PLOT_H - 2 * P);
  const pts = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const col = STATUS_COLOR[w.status];
  const lastX = x(actual.length - 1);
  const lastY = y(actual[actual.length - 1] ?? 0);
  return (
    <svg width={W} height={H} aria-hidden="true" style={{ flexShrink: 0, overflow: 'visible' }}>
      {/* drop-dots: faint tick from each delivered day down to the axis */}
      {actual.map((v, i) => (
        <line key={`drop-${i}`} x1={x(i)} y1={y(v)} x2={x(i)} y2={AXIS_Y} stroke={col} strokeWidth="1" strokeDasharray="1 2" opacity="0.35" />
      ))}
      <polyline points={pts(pace)} fill="none" stroke="var(--slate-300)" strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline points={pts(proj)} fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="1.5 3" opacity="0.7" />
      <polyline points={pts(actual)} fill="none" stroke={col} strokeWidth="2.5" strokeLinecap="round" />
      {actual.length > 0 && <circle cx={lastX} cy={lastY} r="3" fill={col} />}
      <line x1={P} y1={AXIS_Y} x2={W - P} y2={AXIS_Y} stroke="var(--slate-200)" strokeWidth="1" />
      {labels.map((lab, i) => (
        <text key={`lab-${i}`} x={x(i)} y={AXIS_Y + 9} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="var(--text-faint)" fontFamily="var(--font-sans)">{lab}</text>
      ))}
    </svg>
  );
}

function PersonCard({ p, win, onFlag }: { p: PersonTrend; win: 'week' | 'month'; onFlag: () => void }) {
  const w = win === 'week' ? p.week : p.month;
  const delta = w.proj - w.target;
  const projColor = w.status === 'behind' ? 'var(--status-behind)'
    : w.status === 'over' ? 'var(--status-over)'
      : 'var(--sage-700)';
  // Supervision cards carry targetPct and headline the supervised %; direct/BT
  // cards headline delivered hours with a utilization chip. directH is recovered
  // from the window target (= directH × targetPct / 100).
  const isSup = w.targetPct != null;
  const directH = w.targetPct ? (w.target * 100) / w.targetPct : 0;
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--sage-200)', borderRadius: 'var(--radius-xl)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={p.who.split(' ·')[0]} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.who}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{p.subtitle}</div>
        </div>
        <StatusPill intent={w.status}>{w.status}</StatusPill>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        {isSup ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{w.util ?? 0}%</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>supervised</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>target {w.targetPct}% of direct</div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color: projColor }}>
              {w.proj.toFixed(1)}h sup · {directH.toFixed(1)}h direct
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{w.actual.toFixed(1)}h</div>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: STATUS_COLOR[w.status], background: STATUS_BG[w.status], borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>{w.util ?? 0}% util</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>of {w.target.toFixed(1)}h this {win}</div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color: projColor }}>
              → {w.proj.toFixed(1)}h projected
            </div>
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}><Trend w={w} /></div>
      </div>
      {win === 'week' && w.impact && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: w.status === 'over' ? 'var(--status-over)' : 'var(--amber-700)', background: w.status === 'over' ? 'var(--status-over-bg)' : 'var(--amber-50)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>{w.impact}</div>
      )}
      {(w.status === 'behind' || w.status === 'over') && (
        <button
          type="button"
          onClick={onFlag}
          style={{ border: 'none', borderRadius: 'var(--radius-md)', padding: '7px 10px', minHeight: 'var(--tap-target)', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: w.status === 'behind' ? 'var(--status-behind-bg)' : 'var(--status-over-bg)', color: w.status === 'behind' ? 'var(--status-behind)' : 'var(--status-over)', fontFamily: 'var(--font-sans)' }}
        >
          {w.status === 'behind' ? 'Fix pace with SAssi →' : 'Review overage with SAssi →'}
        </button>
      )}
    </div>
  );
}

// ── Ritual definitions (data-aware where cheap) ─────────────────────────────
interface RitualItem { icon: string; text: string; action: RitualAction; }
interface Ritual { tag: string; title: string; items: RitualItem[]; cta: string; }

function buildRituals(conflicts: number, flags: number, openTodos: number): Record<RitualKey, Ritual> {
  const open = conflicts + flags;
  return {
    sunday: {
      tag: 'Sunday · 10 minutes',
      title: 'Review the coming week',
      items: [
        {
          icon: '⚠',
          text: open > 0
            ? `Clear ${plural(conflicts, 'conflict')} and ${plural(flags, 'compliance flag')}`
            : 'No open conflicts or compliance flags',
          action: 'assistant',
        },
        { icon: '📅', text: "Confirm the drafted week fits everyone's targets", action: 'week' },
        { icon: '📈', text: 'Glance the month trends below', action: 'home' },
      ],
      cta: 'Start review',
    },
    midweek: {
      tag: 'Anytime · 5 minutes',
      title: 'Accommodate a request',
      items: [
        { icon: '💬', text: 'Ask SAssi to move or add a session', action: 'assistant' },
        { icon: '☑', text: `${plural(openTodos, 'to-do')} open — one can become a session`, action: 'todos' },
      ],
      cta: 'Ask SAssi',
    },
    friday: {
      tag: 'Friday · 10 minutes',
      title: 'Close out the week',
      items: [
        { icon: '📋', text: 'Review past sessions still marked scheduled', action: 'week' },
        { icon: '🔁', text: 'Convert delivered sessions to completed', action: 'week' },
        { icon: '📈', text: 'Check the month trends before the weekend', action: 'home' },
      ],
      cta: 'Start close-out',
    },
  };
}

// ── To-dos card ─────────────────────────────────────────────────────────────
function TodosCard({ data, todos, onAddTodo, onStartSession }: {
  data: ScheduleData;
  todos: HomeTodo[];
  onAddTodo: (t: NewHomeTodo) => void;
  onStartSession: (t: HomeTodo) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? '');
  const [text, setText] = useState('');
  const [due, setDue] = useState('');

  const clientName = (id: string) => data.clients.find(c => c.id === id || c.name === id)?.name ?? id;

  const submit = () => {
    if (!text.trim() || !clientId) return;
    onAddTodo({ clientId, text, due: due || undefined, sessionType: 'client-session' });
    setText(''); setDue(''); setAdding(false);
  };

  const selectStyle: CSSProperties = {
    fontFamily: 'var(--font-sans)', fontSize: 13, padding: '8px 10px',
    border: '1px solid var(--slate-300)', borderRadius: 'var(--radius-md)',
    background: 'var(--white)', color: 'var(--text-primary)', minHeight: 'var(--tap-target)',
  };

  return (
    <section style={{ background: 'var(--white)', border: '1px solid var(--sage-200)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
      {todos.length === 0 && !adding && (
        <div style={{ padding: '18px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          No to-dos yet. Add one and tag it to a client — “Start → session” places a working block on the calendar.
        </div>
      )}
      {todos.map((t, i) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderTop: i ? '1px solid var(--sage-100)' : 'none', opacity: t.done ? 0.5 : 1 }}>
          <Avatar name={clientName(t.clientId)} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>
              {clientName(t.clientId)}{t.due ? ` · due ${t.due}` : ''}
            </div>
          </div>
          {t.done
            ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sage-700)' }}>On your calendar ✓</span>
            : <Button variant="secondary" size="sm" onClick={() => onStartSession(t)}>Start → session</Button>}
        </div>
      ))}

      <div style={{ borderTop: todos.length ? '1px solid var(--sage-100)' : 'none', padding: '12px 18px' }}>
        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select aria-label="Client" value={clientId} onChange={e => setClientId(e.target.value)} style={selectStyle}>
                {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Input placeholder="What needs doing?" value={text} onChange={e => setText(e.target.value)} />
              </div>
              <div style={{ width: 120 }}>
                <Input placeholder="Due (e.g. Thu)" value={due} onChange={e => setDue(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim() || !clientId}>Add to-do</Button>
              <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setText(''); setDue(''); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} disabled={data.clients.length === 0}>+ Add to-do</Button>
        )}
      </div>
    </section>
  );
}

export function HomeView({ data, now, conflictCount, complianceFlagCount, todos, onAddTodo, onStartSession, onGo }: HomeViewProps) {
  const [ritual, setRitual] = useState<RitualKey>('sunday');
  const [win, setWin] = useState<'week' | 'month'>('week');
  const todosRef = useRef<HTMLDivElement>(null);

  // Ritual-linked default window: Friday close-out looks at the month; else the week.
  useEffect(() => { setWin(ritual === 'friday' ? 'month' : 'week'); }, [ritual]);

  const trends = computeHomeTrends(data, now);
  const openTodos = todos.filter(t => !t.done).length;
  const rituals = buildRituals(conflictCount, complianceFlagCount, openTodos);
  const R = rituals[ritual];

  // 'todos' navigates within Home; everything else bubbles to the app shell.
  const go = (action: RitualAction) => {
    if (action === 'todos') { todosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    onGo(action);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--sage-50)' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '26px 24px 60px' }}>

        {/* Start here */}
        <section style={{ background: 'var(--white)', border: '1px solid var(--sage-200)', borderRadius: 'var(--radius-2xl)', padding: '22px 24px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--sage-600)' }}>Start here · {R.tag}</div>
              <h2 style={{ margin: '3px 0 0', fontSize: 21, fontWeight: 800, color: 'var(--text-primary)' }}>{R.title}</h2>
            </div>
            <SegmentedControl
              size="sm"
              options={[{ value: 'sunday', label: 'Sunday' }, { value: 'midweek', label: 'Midweek' }, { value: 'friday', label: 'Friday' }]}
              value={ritual}
              onChange={(v) => setRitual(v as RitualKey)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
            {R.items.map((it, i) => (
              <button
                key={i}
                type="button"
                onClick={() => go(it.action)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 14px', minHeight: 'var(--tap-target)', background: 'var(--sage-50)', border: '1px solid var(--sage-100)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontSize: 13.5, color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontWeight: 600 }}
              >
                <span aria-hidden="true" style={{ fontSize: 15 }}>{it.icon}</span>{it.text}
                <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--sage-500)' }}>→</span>
              </button>
            ))}
          </div>
          <Button variant="primary" size="lg" onClick={() => go(R.items[0].action)}>{R.cta}</Button>
        </section>

        {/* Trends */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '26px 0 10px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>This {win} — actual · projected · pace</div>
          <div style={{ flex: 1 }} />
          <SegmentedControl
            size="sm"
            options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
            value={win}
            onChange={(v) => setWin(v as 'week' | 'month')}
          />
        </div>
        {trends.length === 0 ? (
          <div style={{ background: 'var(--white)', border: '1px solid var(--sage-200)', borderRadius: 'var(--radius-xl)', padding: 18, fontSize: 12.5, color: 'var(--text-muted)' }}>
            No pace data yet — add authorizations and sessions to see client and BT trends here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {trends.map(p => <PersonCard key={p.id} p={p} win={win} onFlag={() => onGo('assistant')} />)}
          </div>
        )}

        {/* To-dos */}
        <div ref={todosRef} style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '26px 0 10px' }}>To do — tagged to clients</div>
        <TodosCard data={data} todos={todos} onAddTodo={onAddTodo} onStartSession={onStartSession} />
        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 10, lineHeight: 1.5 }}>
          “Start → session” opens the appointment form prefilled for that client — confirm the time and it lands on the calendar.
        </p>
      </div>
    </div>
  );
}

export default HomeView;
