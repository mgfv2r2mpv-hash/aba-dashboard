import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useMemo } from 'react';
import { computeCaseState } from '../caseModel';
import { analyzeCorrections } from '../corrections';
// At-a-glance caseload table mirroring the BCBA's tracking sheet: authorized
// weekly direct vs ideal/actual (+75% flag), supervision % against the
// floor/preferred band, cadence pacing, contacts, and the binding cliffs.
// Plus a prioritized correction list (hard floors first, then soft targets).
export default function CaseloadView({ data, now = new Date() }) {
    const states = useMemo(() => data.clients.map(c => computeCaseState(data, c, now)), [data, now]);
    const report = useMemo(() => analyzeCorrections(data, now), [data, now]);
    const monthLabel = states[0]?.monthLabel || '';
    return (_jsxs("div", { style: { padding: '8px 4px' }, children: [_jsxs("h2", { style: { fontSize: 18, fontWeight: 700, marginBottom: 4 }, children: ["Caseload \u2014 ", monthLabel] }), _jsx("p", { style: { fontSize: 12, color: '#6b7280', marginBottom: 12 }, children: "Weekly authorized direct vs. actual (75% staffing), monthly supervision against the floor/preferred band, cadence pacing, and the binding cliff per case." }), states.length === 0 ? (_jsx("p", { style: { color: '#9ca3af' }, children: "No clients yet." })) : (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 }, children: [_jsx("thead", { children: _jsx("tr", { style: { textAlign: 'left', borderBottom: '2px solid #e5e7eb', color: '#374151' }, children: ['Case', 'Auth/wk', 'Actual/wk', '%', 'Sup %', 'Floor', 'Cadence', 'Contacts', 'PT (mo)', 'Cliff'].map(h => (_jsx("th", { style: { padding: '6px 8px', whiteSpace: 'nowrap' }, children: h }, h))) }) }), _jsx("tbody", { children: states.map(s => _jsx(CaseRow, { s: s }, s.client.id)) })] }) })), _jsxs("h3", { style: { fontSize: 15, fontWeight: 700, margin: '20px 0 8px' }, children: ["Corrections to pace (", report.needs.length, ")"] }), report.needs.length === 0 ? (_jsx("p", { style: { fontSize: 12, color: '#15803d' }, children: "Nothing flagged \u2014 floors met and targets on pace." })) : (_jsx("ul", { style: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }, children: report.needs.map((n, i) => _jsx(NeedRow, { n: n }, i)) }))] }));
}
function CaseRow({ s }) {
    const td = { padding: '6px 8px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' };
    const pct1 = (n) => (Math.round(n * 10) / 10).toString();
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
    return (_jsxs("tr", { children: [_jsx("td", { style: { ...td, fontWeight: 600 }, children: s.client.name }), _jsx("td", { style: td, children: s.direct.authPerWk > 0 ? `${pct1(s.direct.authPerWk)}h` : '—' }), _jsxs("td", { style: { ...td, color: staffColor, fontWeight: 600 }, children: [pct1(s.direct.actualThisWk), "h"] }), _jsx("td", { style: { ...td, color: staffColor }, children: s.direct.authPerWk > 0 ? `${Math.round(s.direct.pctOfAuth)}%` : '—' }), _jsx("td", { style: { ...td, color: supColor, fontWeight: 600 }, children: s.supervision.directHoursMonth > 0 ? `${pct1(s.supervision.pct)}%` : '—' }), _jsxs("td", { style: { ...td, color: '#6b7280' }, children: [s.supervision.floorPct, "/", s.supervision.preferredMinPct, "\u2013", s.supervision.preferredMaxPct] }), _jsx("td", { style: td, children: cadenceLabel }), _jsx("td", { style: td, children: contactStr }), _jsxs("td", { style: td, children: [pct1(s.parentTraining.deliveredMonth), "/", pct1(s.parentTraining.goalMonth), "h"] }), _jsx("td", { style: { ...td, color: cliffColor }, children: s.cliffs.binding === 'service-end'
                    ? `auth ${s.cliffs.daysToServiceEnd ?? '?'}d`
                    : `mo ${s.cliffs.daysToMonthEnd}d` })] }));
}
function NeedRow({ n }) {
    const color = n.priority === 1 ? '#b91c1c' : n.priority === 2 ? '#b45309' : '#6b7280';
    const tag = n.hard ? 'HARD' : `P${n.priority}`;
    return (_jsxs("li", { style: { fontSize: 12, padding: '6px 10px', border: '1px solid #f3f4f6', borderLeft: `3px solid ${color}`, borderRadius: 4, background: 'white' }, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 700, color, marginRight: 8 }, children: tag }), n.detail, n.note && _jsxs("div", { style: { fontSize: 11, color: '#2563eb', marginTop: 2 }, children: ["\u21B3 ", n.note] })] }));
}
//# sourceMappingURL=CaseloadView.js.map