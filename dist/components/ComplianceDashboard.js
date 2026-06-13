import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useMemo } from 'react';
import { computeClientCompliance, computeTechCompliance, pastIncompleteAppointments, monthPeriod, } from '../compliance';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
export default function ComplianceDashboard({ data, cache, onMarkComplete, onRequestCancel, onSelectAppointment }) {
    const [periodRef, setPeriodRef] = useState(new Date());
    const period = useMemo(() => monthPeriod(periodRef), [periodRef]);
    const usingCache = !!cache && cache.period.start.getTime() === period.start.getTime();
    const clientReports = useMemo(() => usingCache
        ? data.clients.map(c => cache.clients.get(c.id)).filter((r) => !!r)
        : computeClientCompliance(data, period), [data, period, cache, usingCache]);
    const techReports = useMemo(() => usingCache
        ? data.technicians.map(t => cache.techs.get(t.id)).filter((r) => !!r)
        : computeTechCompliance(data, period), [data, period, cache, usingCache]);
    const pastIncomplete = useMemo(() => pastIncompleteAppointments(data), [data]);
    const targetPct = data.settings.supervisionDirectHoursPercent || 5;
    const techTargetPct = data.settings.supervisionTechHoursPercent ?? 0;
    const maxPct = data.settings.supervisionMaxHoursPercent;
    const goPrev = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() - 1, 1));
    const goNext = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() + 1, 1));
    const goToday = () => setPeriodRef(new Date());
    return (_jsxs("div", { style: { flex: 1, padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }, children: [_jsxs("h2", { style: { fontSize: 18, fontWeight: 700, margin: 0 }, children: ["Compliance (", period.label, ")"] }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx(NavBtn, { onClick: goPrev, children: "\u2190" }), _jsx(NavBtn, { onClick: goToday, children: "Today" }), _jsx(NavBtn, { onClick: goNext, children: "\u2192" })] })] }), _jsxs("p", { style: { fontSize: 12, color: '#6b7280', marginBottom: 16 }, children: ["Supervision target: ", _jsxs("strong", { children: [targetPct, "%"] }), " of direct hours per client. Counted as overlap minutes between a supervision tagged with the client and any direct session for that client (any tech). A supervision with no overlapping direct (BCBA solo with the client) consumes BCBA time but contributes 0 to compliance."] }), pastIncomplete.length > 0 && (_jsx(PastIncomplete, { items: pastIncomplete, onMarkComplete: onMarkComplete, onRequestCancel: onRequestCancel, onSelect: onSelectAppointment })), _jsx(SectionHeader, { children: "Per client" }), _jsxs("div", { style: { display: 'grid', gap: 12, marginBottom: 24 }, children: [clientReports.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: 20 }, children: "No clients yet. Add clients in Admin to start tracking compliance." })), clientReports.map(r => _jsx(ClientCard, { report: r, targetPct: targetPct, maxPct: maxPct }, r.client.id))] }), _jsx(SectionHeader, { children: "Per technician" }), _jsxs("p", { style: { fontSize: 12, color: '#6b7280', marginTop: -8, marginBottom: 8 }, children: ["RBTs must hit BACB ", _jsxs("strong", { children: [BACB_RBT_SUPERVISION_MIN_PERCENT, "%"] }), " AND the company target (", data.settings.supervisionRBTHoursPercent, "%). Non-RBT techs follow the company-only target (", techTargetPct, "%). Numerator counts supervision time overlapping that tech's direct sessions regardless of which client the supervision was tagged with."] }), _jsxs("div", { style: { display: 'grid', gap: 12 }, children: [techReports.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: 20 }, children: "No technicians yet." })), techReports.map(r => _jsx(TechCard, { report: r, maxPct: maxPct }, r.tech.id))] })] }));
}
function SectionHeader({ children }) {
    return (_jsx("h3", { style: {
            fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
            color: '#374151', margin: '0 0 8px',
        }, children: children }));
}
// ---------- Past sessions to review ----------
function PastIncomplete({ items, onMarkComplete, onRequestCancel, onSelect }) {
    const [collapsed, setCollapsed] = useState(false);
    return (_jsxs("div", { style: {
            backgroundColor: '#fef3c7', border: '1px solid #f59e0b',
            borderRadius: 8, padding: 12, marginBottom: 16,
        }, children: [_jsxs("button", { onClick: () => setCollapsed(c => !c), style: {
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: 700, color: '#92400e', padding: 0,
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    justifyContent: 'space-between',
                }, children: [_jsxs("span", { children: ["Past sessions to review (", items.length, ")"] }), _jsx("span", { children: collapsed ? '▸' : '▾' })] }), !collapsed && (_jsxs("div", { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }, children: [_jsx("p", { style: { fontSize: 11, color: '#92400e', margin: 0, marginBottom: 4 }, children: "Incomplete past appointments count toward compliance until canceled or deleted. Convert these in a timely manner for most accurate compliance tracking." }), items.map(a => (_jsx(PastIncompleteRow, { a: a, onMarkComplete: onMarkComplete, onRequestCancel: onRequestCancel, onSelect: onSelect }, a.id)))] }))] }));
}
// A single past-incomplete row. ✓ Complete opens an inline editor prefilled
// with the scheduled start/end so the user nudges them to the actual rendered
// times before accepting (one tap accepts unchanged). Speed matters: this is
// the high-frequency path for matching the roll to delivered minutes.
function PastIncompleteRow({ a, onMarkComplete, onRequestCancel, onSelect }) {
    const [editing, setEditing] = useState(false);
    const [startClock, setStartClock] = useState(a.startTime.slice(11, 16));
    const [endClock, setEndClock] = useState(a.endTime.slice(11, 16));
    const accept = () => {
        const date = a.startTime.slice(0, 10);
        const newStart = `${date}T${startClock}:00`;
        const newEnd = `${date}T${endClock}:00`;
        if (newEnd <= newStart) {
            alert('End time must be after the start time.');
            return;
        }
        onMarkComplete({ ...a, startTime: newStart, endTime: newEnd });
    };
    return (_jsxs("div", { style: {
            backgroundColor: 'white', borderRadius: 6, padding: 8,
            display: 'flex', flexDirection: 'column', gap: 6,
        }, children: [_jsx("button", { onClick: () => onSelect(a), style: {
                    background: 'none', border: 'none', padding: 0, textAlign: 'left',
                    fontSize: 13, fontWeight: 600, color: '#1d4ed8', cursor: 'pointer',
                    textDecoration: 'underline',
                }, children: a.title }), _jsxs("div", { style: { fontSize: 11, color: '#6b7280' }, children: [new Date(a.startTime).toLocaleString(), " \u2192 ", new Date(a.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), a.client && _jsxs(_Fragment, { children: [" \u00B7 ", a.client] }), a.technician && _jsxs(_Fragment, { children: [" \u00B7 ", a.technician] })] }), editing ? (_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsxs("label", { style: { fontSize: 11, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }, children: ["Start", _jsx("input", { type: "time", step: "900", value: startClock, onChange: e => setStartClock(e.target.value), style: timeInput })] }), _jsxs("label", { style: { fontSize: 11, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }, children: ["End", _jsx("input", { type: "time", step: "900", value: endClock, onChange: e => setEndClock(e.target.value), style: timeInput })] }), _jsx("button", { onClick: accept, style: completeBtn, children: "Accept" }), _jsx("button", { onClick: () => setEditing(false), style: ghostBtn, children: "Cancel" })] })) : (_jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("button", { onClick: () => setEditing(true), style: completeBtn, children: "\u2713 Complete" }), _jsx("button", { onClick: () => onRequestCancel(a), style: cancelBtn, children: "\u2715 Cancel" })] }))] }));
}
// ---------- Per-client card ----------
function ClientCard({ report, targetPct, maxPct }) {
    const { client, actual, projected } = report;
    const noDirect = actual.directHours === 0 && projected.directHours === 0;
    // Status: green if actual already meets, yellow if projected meets but actual
    // doesn't, red if even projected falls short. Inactive clients (no direct
    // hours) get a neutral gray.
    let status;
    if (noDirect)
        status = 'gray';
    else if (actual.pct >= targetPct)
        status = 'green';
    else if (projected.pct >= targetPct)
        status = 'yellow';
    else
        status = 'red';
    const accentColor = statusColor(status);
    return (_jsxs("div", { style: {
            backgroundColor: 'white',
            border: `2px solid ${accentColor}`,
            borderRadius: 8, padding: 12,
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, children: [_jsx("h3", { style: { fontSize: 15, fontWeight: 700, margin: 0 }, children: client.name }), _jsx("span", { style: {
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                            color: 'white', backgroundColor: accentColor,
                            padding: '2px 8px', borderRadius: 10,
                        }, children: statusLabel(status) })] }), noDirect ? (_jsxs("p", { style: { fontSize: 12, color: '#6b7280', margin: 0 }, children: ["No direct sessions in ", monthLabel(report), ". Nothing to supervise."] })) : (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: [_jsx(Metric, { title: "Actual", m: actual, targetPct: targetPct, accent: accentColor, maxPct: maxPct }), _jsx(Metric, { title: "Projected", m: projected, targetPct: targetPct, accent: accentColor, maxPct: maxPct })] }))] }));
}
function TechCard({ report, maxPct }) {
    const { tech, actual, projected } = report;
    const noDirect = actual.directHours === 0 && projected.directHours === 0;
    // A tech misses if they fall short on EITHER applicable threshold (BACB
    // for RBTs and/or company). Status uses the tighter of actual + projected.
    const status = techStatus(actual, projected, tech.isRBT, noDirect);
    const accent = statusColor(status);
    return (_jsxs("div", { style: {
            backgroundColor: 'white',
            border: `2px solid ${accent}`,
            borderRadius: 8, padding: 12,
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }, children: [_jsxs("h3", { style: { fontSize: 15, fontWeight: 700, margin: 0 }, children: [tech.name, _jsx("span", { style: {
                                    marginLeft: 6, fontSize: 10, fontWeight: 700,
                                    color: '#6b7280', backgroundColor: '#e5e7eb',
                                    padding: '2px 6px', borderRadius: 8,
                                }, children: tech.isRBT ? 'RBT' : 'BT' })] }), _jsx("span", { style: {
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                            color: 'white', backgroundColor: accent,
                            padding: '2px 8px', borderRadius: 10,
                        }, children: statusLabel(status) })] }), noDirect ? (_jsx("p", { style: { fontSize: 12, color: '#6b7280', margin: 0 }, children: "No direct sessions this period. Nothing to supervise." })) : (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: [_jsx(TechMetric, { title: "Actual", m: actual, accent: accent, isRBT: tech.isRBT, maxPct: maxPct }), _jsx(TechMetric, { title: "Projected", m: projected, accent: accent, isRBT: tech.isRBT, maxPct: maxPct })] }))] }));
}
function TechMetric({ title, m, accent, isRBT, maxPct }) {
    // Bar fills against whichever requirement is HIGHER (the binding one) so the
    // user sees how far they are from passing both checks.
    const bindingPct = isRBT
        ? Math.max(BACB_RBT_SUPERVISION_MIN_PERCENT, m.companyRequiredPct)
        : m.companyRequiredPct;
    const fillPct = bindingPct > 0 ? Math.min(100, (m.pct / bindingPct) * 100) : 0;
    const overCap = maxPct !== undefined && m.pct > maxPct;
    const pctColor = overCap ? CAP_OVER : accent;
    return (_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }, children: title }), _jsxs("div", { style: { fontSize: 18, fontWeight: 700, color: pctColor }, children: [m.pct.toFixed(1), "%", overCap && (_jsxs("div", { style: { fontSize: 11, color: CAP_OVER, fontWeight: 600, marginTop: 2 }, children: ["\u26A0 over ", maxPct, "% insurer cap"] }))] }), _jsx("div", { style: {
                    marginTop: 6, height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden',
                }, children: _jsx("div", { style: {
                        height: '100%', width: `${fillPct}%`,
                        backgroundColor: accent, transition: 'width 200ms',
                    } }) }), _jsxs("div", { style: { fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }, children: ["Direct: ", _jsxs("strong", { children: [m.directHours.toFixed(1), "h"] }), " \u00B7 Sup: ", _jsxs("strong", { children: [m.supervisionHours.toFixed(1), "h"] }), isRBT && m.bacbRequiredHours !== undefined && (_jsxs("div", { children: ["BACB ", BACB_RBT_SUPERVISION_MIN_PERCENT, "%: need ", _jsxs("strong", { children: [m.bacbRequiredHours.toFixed(1), "h"] }), m.bacbHoursToGo > 0
                                ? _jsxs(_Fragment, { children: [" \u00B7 to go ", _jsxs("strong", { style: { color: accent }, children: [m.bacbHoursToGo.toFixed(1), "h"] })] })
                                : _jsx(_Fragment, { children: " \u00B7 \u2713" })] })), _jsxs("div", { children: ["Company ", m.companyRequiredPct, "%: need ", _jsxs("strong", { children: [m.companyRequiredHours.toFixed(1), "h"] }), m.companyHoursToGo > 0
                                ? _jsxs(_Fragment, { children: [" \u00B7 to go ", _jsxs("strong", { style: { color: accent }, children: [m.companyHoursToGo.toFixed(1), "h"] })] })
                                : _jsx(_Fragment, { children: " \u00B7 \u2713" })] })] })] }));
}
function techStatus(actual, projected, isRBT, noDirect) {
    if (noDirect)
        return 'gray';
    const passes = (m) => {
        const bacbOk = !isRBT || (m.bacbHoursToGo ?? 0) === 0;
        const companyOk = m.companyHoursToGo === 0;
        return bacbOk && companyOk;
    };
    if (passes(actual))
        return 'green';
    if (passes(projected))
        return 'yellow';
    return 'red';
}
function statusColor(s) {
    return s === 'green' ? '#15803d'
        : s === 'yellow' ? '#a16207'
            : s === 'red' ? '#b91c1c'
                : '#6b7280';
}
// Distinct from the green/yellow/red status colors so the over-cap warning
// doesn't get confused with the under-min status pill.
const CAP_OVER = '#ea580c';
function Metric({ title, m, targetPct, accent, maxPct }) {
    const fillPct = Math.min(100, m.pct);
    const overCap = maxPct !== undefined && m.pct > maxPct;
    const pctColor = overCap ? CAP_OVER : accent;
    return (_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }, children: title }), _jsxs("div", { style: { fontSize: 18, fontWeight: 700, color: pctColor }, children: [m.pct.toFixed(1), "%", _jsxs("span", { style: { fontSize: 11, color: '#6b7280', fontWeight: 400, marginLeft: 6 }, children: ["of ", targetPct, "% target"] }), overCap && (_jsxs("div", { style: { fontSize: 11, color: CAP_OVER, fontWeight: 600, marginTop: 2 }, children: ["\u26A0 over ", maxPct, "% insurer cap"] }))] }), _jsx("div", { style: {
                    marginTop: 6, height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden',
                }, children: _jsx("div", { style: {
                        height: '100%', width: `${fillPct}%`,
                        backgroundColor: accent, transition: 'width 200ms',
                    } }) }), _jsxs("div", { style: { fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }, children: ["Direct: ", _jsxs("strong", { children: [m.directHours.toFixed(1), "h"] }), " \u00B7 Sup: ", _jsxs("strong", { children: [m.supervisionHours.toFixed(1), "h"] }), _jsx("br", {}), "Required: ", _jsxs("strong", { children: [m.requiredHours.toFixed(1), "h"] }), m.hoursToGo > 0 && (_jsxs(_Fragment, { children: [" \u00B7 To go: ", _jsxs("strong", { style: { color: accent }, children: [m.hoursToGo.toFixed(1), "h"] })] })), m.hoursToGo === 0 && m.directHours > 0 && (_jsx(_Fragment, { children: " \u00B7 \u2713 at target" }))] })] }));
}
function monthLabel(r) {
    // Just used in a display string; the metric carries enough context.
    return 'this period';
}
function statusLabel(s) {
    switch (s) {
        case 'green': return 'on target';
        case 'yellow': return 'projected ok';
        case 'red': return 'behind';
        case 'gray': return 'inactive';
    }
}
function NavBtn({ onClick, children }) {
    return (_jsx("button", { onClick: onClick, style: {
            padding: '6px 12px', backgroundColor: '#e5e7eb', border: 'none',
            borderRadius: 4, cursor: 'pointer', fontSize: 13,
        }, children: children }));
}
const completeBtn = {
    flex: '1 1 auto', padding: '5px 9px',
    backgroundColor: '#dcfce7', color: '#15803d',
    border: '1px solid #86efac', borderRadius: 4,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const cancelBtn = {
    flex: '1 1 auto', padding: '5px 9px',
    backgroundColor: '#fee2e2', color: '#b91c1c',
    border: '1px solid #fca5a5', borderRadius: 4,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const ghostBtn = {
    padding: '5px 9px',
    backgroundColor: 'white', color: '#6b7280',
    border: '1px solid #d1d5db', borderRadius: 4,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const timeInput = {
    fontSize: 12, padding: '3px 6px',
    border: '1px solid #d1d5db', borderRadius: 4,
};
//# sourceMappingURL=ComplianceDashboard.js.map