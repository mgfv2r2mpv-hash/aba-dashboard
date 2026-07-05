import { useEffect, useId, useRef, useState, CSSProperties } from 'react';
import type { ScheduleData } from '../types';
import { computeHomeTrends, fmtSignedHours, PersonTrend, TrendWindow, TrendStatus } from '../caseModel';
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
  /** Hand a case-scoped "Fix pace with SAssi" request to the dock. */
  onMeetPace?: (clientId: string, intent: 'behind' | 'over') => void;
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

// Small labelled chip used for the direct card's two rates (% of auth, % of plan).
const chipStyle = (color: string, bg: string): CSSProperties => ({
  fontSize: 10, fontWeight: 800, color, background: bg,
  borderRadius: 'var(--radius-sm)', padding: '1px 6px', whiteSpace: 'nowrap',
});

// ── Trend sparkline: a translucent PLAN envelope (cumulative scheduled) with the
//    solid DELIVERED line riding above (make-ups) or below (cancellations) its
//    edge, plus a dotted PROJECTED tail to period end, over a dated x-axis. Any
//    portion past the authorization line (plan, delivered, or the tail) renders
//    amber — recurring overage burns the auth bucket faster than planned ───────
function Trend({ w }: { w: TrendWindow }) {
  const uid = useId();
  const W = 140, PLOT_H = 40, P = 3;
  const { plan, delivered, projTail, labels } = w.series;
  const n = Math.max(plan.length - 1, 1);
  const max = Math.max(...plan, ...delivered, ...projTail, 0.001) * 1.08;
  const AXIS_Y = PLOT_H - P;
  const H = AXIS_Y + 12;              // room for the axis + a label band
  const x = (i: number) => P + (i / n) * (W - 2 * P);
  const y = (v: number) => AXIS_Y - (v / max) * (PLOT_H - 2 * P);
  const pts = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const col = STATUS_COLOR[w.status];
  // Filled area under the cumulative scheduled line = the plan envelope.
  const planArea = `${x(0)},${AXIS_Y} ${pts(plan)} ${x(plan.length - 1)},${AXIS_Y}`;
  const cur = Math.max(delivered.length - 1, 0);                 // last delivered bucket (today)
  const tail = projTail.slice(cur).map((v, k) => `${x(cur + k)},${y(v)}`).join(' ');
  const lastX = x(cur), lastY = y(delivered[cur] ?? 0);

  // Authorization line: only draw/split when it actually falls within the plotted
  // range — if the case is far under target, the line would sit off the top edge
  // and there's nothing to flag yet.
  const authYRaw = w.target > 0 ? y(w.target) : null;
  const authY = authYRaw != null && authYRaw >= P - 0.5 ? Math.min(Math.max(authYRaw, P), AXIS_Y) : null;
  const belowId = `trend-below-${uid}`;
  const aboveId = `trend-above-${uid}`;
  const belowClip = authY != null ? `url(#${belowId})` : undefined;
  const aboveClip = authY != null ? `url(#${aboveId})` : undefined;
  const overAuth = authY != null && lastY < authY;

  return (
    <svg width={W} height={H} aria-hidden="true" style={{ flexShrink: 0, overflow: 'visible' }}>
      {authY != null && (
        <defs>
          <clipPath id={belowId}><rect x="0" y={authY} width={W} height={Math.max(AXIS_Y - authY, 0) + 1} /></clipPath>
          <clipPath id={aboveId}><rect x="0" y="0" width={W} height={authY} /></clipPath>
        </defs>
      )}
      {/* translucent plan envelope: status color below auth, amber above it */}
      <polygon points={planArea} fill={col} opacity="0.14" clipPath={belowClip} />
      {authY != null && <polygon points={planArea} fill="var(--amber-500)" opacity="0.28" clipPath={aboveClip} />}
      <polyline points={pts(plan)} fill="none" stroke={col} strokeWidth="1" opacity="0.35" />
      {authY != null && (
        <line x1={P} y1={authY} x2={W - P} y2={authY} stroke="var(--amber-600)" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
      )}
      {/* dotted projected tail, amber where it crosses above auth */}
      {projTail.length - 1 > cur && (
        <>
          <polyline points={tail} fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="1.5 3" opacity="0.75" clipPath={belowClip} />
          {authY != null && <polyline points={tail} fill="none" stroke="var(--amber-700)" strokeWidth="1.5" strokeDasharray="1.5 3" opacity="0.9" clipPath={aboveClip} />}
        </>
      )}
      {/* solid delivered line, amber where it climbs above auth */}
      {delivered.length > 1 && (
        <>
          <polyline points={pts(delivered)} fill="none" stroke={col} strokeWidth="2.5" strokeLinecap="round" clipPath={belowClip} />
          {authY != null && <polyline points={pts(delivered)} fill="none" stroke="var(--amber-700)" strokeWidth="2.5" strokeLinecap="round" clipPath={aboveClip} />}
        </>
      )}
      {delivered.length > 0 && <circle cx={lastX} cy={lastY} r="3" fill={overAuth ? 'var(--amber-700)' : col} />}
      <line x1={P} y1={AXIS_Y} x2={W - P} y2={AXIS_Y} stroke="var(--slate-200)" strokeWidth="1" />
      {labels.map((lab, i) => (
        <text key={`lab-${i}`} x={x(i)} y={AXIS_Y + 9} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="var(--text-faint)" fontFamily="var(--font-sans)">{lab}</text>
      ))}
    </svg>
  );
}

function PersonCard({ p, win, onFlag, onMeetPace }: {
  p: PersonTrend;
  win: 'week' | 'month';
  onFlag: () => void;
  onMeetPace?: (clientId: string, intent: 'behind' | 'over') => void;
}) {
  const w = win === 'week' ? p.week : p.month;
  // Badge + CTA are graded on the MONTH's pace toward auth (so a light or holiday
  // week doesn't over-alarm); the chart/line color still reflects this window.
  const badge = p.month.status;
  // Client cards can hand a case-scoped rearrange straight to SAssi; tech cards
  // (BT direct) fall back to opening the assistant. `p.id` is `${clientId}-direct`
  // or `${clientId}-supervision`.
  const clientId = p.role === 'client' ? p.id.replace(/-(direct|supervision)$/, '') : null;
  const fixPace = () => {
    if (clientId && onMeetPace) onMeetPace(clientId, badge === 'over' ? 'over' : 'behind');
    else onFlag();
  };
  const lineColor = w.status === 'behind' ? 'var(--status-behind)'
    : w.status === 'over' ? 'var(--status-over)'
      : 'var(--sage-700)';
  // Supervision cards headline the supervised %; direct/BT cards headline PLANNED
  // hours with delivered progress + two rate chips. directH is recovered from the
  // window target (= directH × targetPct / 100).
  const isSup = w.targetPct != null;
  const directH = w.targetPct ? (w.target * 100) / w.targetPct : 0;
  // vs-plan caption: delivered − scheduled-to-date (below plan = cancellations).
  const v = w.varianceH ?? 0;
  const caption = v === 0 ? 'on plan' : `${fmtSignedHours(v)} ${v < 0 ? 'behind' : 'ahead of'} plan`;
  const showCaption = win === 'week' && w.planned > 0.05;
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--sage-200)', borderRadius: 'var(--radius-xl)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={p.who.split(' ·')[0]} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.who}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{p.subtitle}</div>
        </div>
        <StatusPill intent={badge}>{badge}</StatusPill>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        {isSup ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{w.util ?? 0}%</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>supervised</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>target {w.targetPct}% of direct</div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color: lineColor }}>
              {w.planned.toFixed(1)}h sup · {directH.toFixed(1)}h direct
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{w.planned.toFixed(1)}h</div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>planned</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{w.delivered.toFixed(1)}h done</span>
              <span style={chipStyle('var(--sage-700)', 'var(--sage-50)')}>{w.pctOfAuth ?? 0}% of auth</span>
              <span style={chipStyle(STATUS_COLOR[w.status], STATUS_BG[w.status])}>{w.pctOfPlan ?? 0}% of plan</span>
            </div>
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}><Trend w={w} /></div>
      </div>
      {showCaption && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: v < 0 ? 'var(--amber-700)' : 'var(--sage-700)', background: v < 0 ? 'var(--amber-50)' : 'var(--sage-50)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>{caption}</div>
      )}
      {(badge === 'behind' || badge === 'over') && (
        <button
          type="button"
          onClick={fixPace}
          style={{ border: 'none', borderRadius: 'var(--radius-md)', padding: '7px 10px', minHeight: 'var(--tap-target)', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: badge === 'behind' ? 'var(--status-behind-bg)' : 'var(--status-over-bg)', color: badge === 'behind' ? 'var(--status-behind)' : 'var(--status-over)', fontFamily: 'var(--font-sans)' }}
        >
          {badge === 'behind' ? 'Fix pace with SAssi →' : 'Review overage with SAssi →'}
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

export function HomeView({ data, now, conflictCount, complianceFlagCount, todos, onAddTodo, onStartSession, onGo, onMeetPace }: HomeViewProps) {
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
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>This {win} — planned · delivered · pace</div>
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
            {trends.map(p => <PersonCard key={p.id} p={p} win={win} onFlag={() => onGo('assistant')} onMeetPace={onMeetPace} />)}
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
