import { useMemo, CSSProperties } from 'react';
import { ScheduleData } from '../types';
import { computeCaseState, CaseState } from '../caseModel';
import { analyzeCorrections, CorrectionNeed } from '../corrections';

// At-a-glance caseload table mirroring the BCBA's tracking sheet: authorized
// weekly direct vs ideal/actual (+75% flag), supervision % against the
// floor/preferred band, cadence pacing, contacts, and the binding cliffs.
// Plus a prioritized correction list (hard floors first, then soft targets).
export default function CaseloadView({ data, now = new Date() }: { data: ScheduleData; now?: Date }) {
  const states = useMemo(
    () => data.clients.map(c => computeCaseState(data, c, now)),
    [data, now],
  );
  const report = useMemo(() => analyzeCorrections(data, now), [data, now]);

  const monthLabel = states[0]?.monthLabel || '';

  return (
    <div style={{ padding: '8px 4px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Caseload — {monthLabel}</h2>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        Weekly authorized direct vs. actual (75% staffing), monthly supervision against the floor/preferred band,
        cadence pacing, and the binding cliff per case.
      </p>

      {states.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No clients yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb', color: '#374151' }}>
                {['Case', 'Auth/wk', 'Actual/wk', '%', 'Sup %', 'Floor', 'Cadence', 'Contacts', 'PT (mo)', 'Cliff'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {states.map(s => <CaseRow key={s.client.id} s={s} />)}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '20px 0 8px' }}>
        Corrections to pace ({report.needs.length})
      </h3>
      {report.needs.length === 0 ? (
        <p style={{ fontSize: 12, color: '#15803d' }}>Nothing flagged — floors met and targets on pace.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          {report.needs.map((n, i) => <NeedRow key={i} n={n} />)}
        </ul>
      )}
    </div>
  );
}

function CaseRow({ s }: { s: CaseState }) {
  const td: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' };
  const pct1 = (n: number) => (Math.round(n * 10) / 10).toString();

  const staffColor = s.direct.authPerWk === 0 ? '#9ca3af' : s.direct.below75 ? '#b45309' : '#15803d';
  const supColor = s.supervision.directHoursMonth === 0 ? '#9ca3af'
    : s.supervision.gapToFloor > 0.01 ? '#b91c1c'
    : s.supervision.overCap ? '#ea580c'
    : s.supervision.pct < s.supervision.preferredMinPct ? '#b45309'
    : '#15803d';
  const cliffColor = s.cliffs.binding === 'service-end' && (s.cliffs.daysToServiceEnd ?? 99) <= 21 ? '#b91c1c' : '#6b7280';

  const cadenceLabel = s.supervision.cadenceGoal
    ? `${s.supervision.cadenceGoal}`
    : '—';
  const contactStr = s.supervision.contactsRequiredByCadence !== undefined
    ? `${s.supervision.contactsThisMonth}/${s.supervision.contactsRequiredByCadence}`
    : `${s.supervision.contactsThisMonth}`;

  return (
    <tr>
      <td style={{ ...td, fontWeight: 600 }}>{s.client.name}</td>
      <td style={td}>{s.direct.authPerWk > 0 ? `${pct1(s.direct.authPerWk)}h` : '—'}</td>
      <td style={{ ...td, color: staffColor, fontWeight: 600 }}>{pct1(s.direct.actualThisWk)}h</td>
      <td style={{ ...td, color: staffColor }}>{s.direct.authPerWk > 0 ? `${Math.round(s.direct.pctOfAuth)}%` : '—'}</td>
      <td style={{ ...td, color: supColor, fontWeight: 600 }}>{s.supervision.directHoursMonth > 0 ? `${pct1(s.supervision.pct)}%` : '—'}</td>
      <td style={{ ...td, color: '#6b7280' }}>{s.supervision.floorPct}/{s.supervision.preferredMinPct}–{s.supervision.preferredMaxPct}</td>
      <td style={td}>{cadenceLabel}</td>
      <td style={td}>{contactStr}</td>
      <td style={td}>{pct1(s.parentTraining.deliveredMonth)}/{pct1(s.parentTraining.goalMonth)}h</td>
      <td style={{ ...td, color: cliffColor }}>
        {s.cliffs.binding === 'service-end'
          ? `auth ${s.cliffs.daysToServiceEnd ?? '?'}d`
          : `mo ${s.cliffs.daysToMonthEnd}d`}
      </td>
    </tr>
  );
}

function NeedRow({ n }: { n: CorrectionNeed }) {
  const color = n.priority === 1 ? '#b91c1c' : n.priority === 2 ? '#b45309' : '#6b7280';
  const tag = n.hard ? 'HARD' : `P${n.priority}`;
  return (
    <li style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #f3f4f6', borderLeft: `3px solid ${color}`, borderRadius: 4, background: 'white' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color, marginRight: 8 }}>{tag}</span>
      {n.detail}
      {n.note && <div style={{ fontSize: 11, color: '#2563eb', marginTop: 2 }}>↳ {n.note}</div>}
    </li>
  );
}
