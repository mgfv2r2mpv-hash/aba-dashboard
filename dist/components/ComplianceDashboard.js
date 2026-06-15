import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useMemo } from 'react';
import { computeClientCompliance, computeTechCompliance, computeTechContactDays, pastIncompleteAppointments, monthPeriod, } from '../compliance';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
import CompleteTimePrompt from './CompleteTimePrompt';
import ConflictPanel from './ConflictPanel';
import FixItPanel from './FixItPanel';
export default function ComplianceDashboard({ data, cache, conflicts = [], aiSettings, mutedConflictKeys, onMuteConflict, onUnmuteConflict, onConfirmDismissConflict, onMarkComplete, onRequestCancel, onSelectAppointment, onAcceptFix, onCustomizeFix }) {
    const [periodRef, setPeriodRef] = useState(new Date());
    const [compView, setCompView] = useState('case');
    const period = useMemo(() => monthPeriod(periodRef), [periodRef]);
    const usingCache = !!cache && cache.period.start.getTime() === period.start.getTime();
    const clientReports = useMemo(() => usingCache
        ? data.clients.map(c => cache.clients.get(c.id)).filter((r) => !!r)
        : computeClientCompliance(data, period), [data, period, cache, usingCache]);
    const techReports = useMemo(() => usingCache
        ? data.technicians.map(t => cache.techs.get(t.id)).filter((r) => !!r)
        : computeTechCompliance(data, period), [data, period, cache, usingCache]);
    const techContactDays = useMemo(() => {
        const map = new Map();
        for (const tech of data.technicians) {
            map.set(tech.id, {
                actual: computeTechContactDays(data, tech, period, 'actual'),
                projected: computeTechContactDays(data, tech, period, 'projected'),
            });
        }
        return map;
    }, [data, period]);
    const rbtMinContacts = data.settings.rbtMinContactsPerMonth ?? 2;
    const btMinContacts = data.settings.techMinContactsPerMonth ?? 1;
    const pastIncomplete = useMemo(() => pastIncompleteAppointments(data), [data]);
    const targetPct = data.settings.supervisionDirectHoursPercent || 5;
    const companyPreferredPct = data.settings.supervisionPreferredMinPercent ?? 15;
    // Per-client override falls back to the company-wide preferred minimum.
    const clientPreferredPct = (client) => client.supervisionIdealPct ?? companyPreferredPct;
    const techTargetPct = data.settings.supervisionTechHoursPercent ?? 0;
    const maxPct = data.settings.supervisionMaxHoursPercent;
    const goPrev = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() - 1, 1));
    const goNext = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() + 1, 1));
    const goToday = () => setPeriodRef(new Date());
    const tabBtn = (v, label) => (_jsx("button", { onClick: () => setCompView(v), style: {
            padding: '5px 14px', border: 'none', borderRadius: 5, cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: compView === v ? '#1d4ed8' : 'transparent',
            color: compView === v ? 'white' : '#374151',
        }, children: label }));
    return (_jsxs("div", { style: { flex: 1, padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }, children: [_jsxs("h2", { style: { fontSize: 18, fontWeight: 700, margin: 0 }, children: ["Compliance (", period.label, ")"] }), _jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsxs("div", { style: { display: 'flex', background: '#f3f4f6', borderRadius: 6, padding: 2, marginRight: 4 }, children: [tabBtn('case', 'Cases'), tabBtn('staff', 'Staff')] }), _jsx(NavBtn, { onClick: goPrev, children: "\u2190" }), _jsx(NavBtn, { onClick: goToday, children: "Today" }), _jsx(NavBtn, { onClick: goNext, children: "\u2192" })] })] }), aiSettings && onAcceptFix && onCustomizeFix && (_jsx(FixItPanel, { data: data, aiSettings: aiSettings, conflicts: conflicts, onAccept: onAcceptFix, onCustomize: onCustomizeFix })), conflicts.length > 0 && (_jsx(ScheduleWarnings, { conflicts: conflicts, appointments: data.appointments, onSelect: onSelectAppointment, mutedConflictKeys: mutedConflictKeys, onMuteConflict: onMuteConflict, onUnmuteConflict: onUnmuteConflict, onConfirmDismissConflict: onConfirmDismissConflict })), pastIncomplete.length > 0 && (_jsx(PastIncomplete, { items: pastIncomplete, onMarkComplete: onMarkComplete, onRequestCancel: onRequestCancel, onSelect: onSelectAppointment })), compView === 'case' && (_jsxs(_Fragment, { children: [_jsxs("p", { style: { fontSize: 12, color: '#6b7280', marginBottom: 12 }, children: ["Supervision target: ", _jsxs("strong", { children: [targetPct, "%"] }), " of direct hours per client."] }), _jsxs("div", { style: { display: 'grid', gap: 12 }, children: [clientReports.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: 20 }, children: "No clients yet. Add clients in Admin to start tracking compliance." })), [...clientReports].sort((a, b) => {
                                const aPref = clientPreferredPct(a.client);
                                const bPref = clientPreferredPct(b.client);
                                const aLevel = getActualLevel(a.actual.directHours, a.actual.pct, targetPct, aPref, maxPct);
                                const bLevel = getActualLevel(b.actual.directHours, b.actual.pct, targetPct, bPref, maxPct);
                                const aPLevel = getProjectedLevel(a.projected.directHours, a.projected.pct, targetPct, aPref, maxPct);
                                const bPLevel = getProjectedLevel(b.projected.directHours, b.projected.pct, targetPct, bPref, maxPct);
                                const aCrit = overallBadge(aLevel, aPLevel, a.actual.directHours === 0 && a.projected.directHours === 0).isCritical;
                                const bCrit = overallBadge(bLevel, bPLevel, b.actual.directHours === 0 && b.projected.directHours === 0).isCritical;
                                if (aCrit !== bCrit)
                                    return aCrit ? -1 : 1;
                                return a.client.name.localeCompare(b.client.name);
                            }).map(r => _jsx(ClientCard, { report: r, targetPct: targetPct, preferredPct: clientPreferredPct(r.client), maxPct: maxPct }, r.client.id))] })] })), compView === 'staff' && (_jsxs(_Fragment, { children: [_jsxs("p", { style: { fontSize: 12, color: '#6b7280', marginBottom: 12 }, children: ["RBTs must hit BACB ", _jsxs("strong", { children: [BACB_RBT_SUPERVISION_MIN_PERCENT, "%"] }), " AND the company target (", data.settings.supervisionRBTHoursPercent, "%), plus \u2265", rbtMinContacts, " supervision contacts/month. Non-RBT BTs follow the company-only target (", techTargetPct, "%) and require \u2265", btMinContacts, " contact(s)/month if they have direct sessions."] }), _jsxs("div", { style: { display: 'grid', gap: 12 }, children: [techReports.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: 20 }, children: "No technicians yet." })), techReports.map(r => (_jsx(TechCard, { report: r, maxPct: maxPct, contacts: techContactDays.get(r.tech.id), rbtMinContacts: rbtMinContacts, btMinContacts: btMinContacts }, r.tech.id)))] })] }))] }));
}
// The calendar's schedule warnings, surfaced on the Compliance tab in a
// collapsible area (collapsed by default so the compliance cards lead). Reuses
// ConflictPanel — which carries the per-conflict confirm/mute controls.
function ScheduleWarnings({ conflicts, appointments, onSelect, mutedConflictKeys, onMuteConflict, onUnmuteConflict, onConfirmDismissConflict }) {
    const [collapsed, setCollapsed] = useState(true);
    return (_jsxs("div", { style: { marginBottom: 16, border: '1px solid #fcd34d', borderRadius: 8, overflow: 'hidden' }, children: [_jsxs("button", { onClick: () => setCollapsed(c => !c), style: {
                    width: '100%', background: '#fffbeb', border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: 700, color: '#92400e', padding: '10px 12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                }, children: [_jsxs("span", { children: ["\u26A0\uFE0F Schedule warnings (", conflicts.length, ")"] }), _jsx("span", { children: collapsed ? '▸' : '▾' })] }), !collapsed && (_jsx(ConflictPanel, { conflicts: conflicts, appointments: appointments, onSelectAppointment: onSelect, mutedKeys: mutedConflictKeys, onMute: onMuteConflict, onUnmute: onUnmuteConflict, onConfirmDismiss: onConfirmDismissConflict }))] }));
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
    return (_jsxs("div", { style: {
            backgroundColor: 'white', borderRadius: 6, padding: 8,
            display: 'flex', flexDirection: 'column', gap: 6,
        }, children: [_jsx("button", { onClick: () => onSelect(a), style: {
                    background: 'none', border: 'none', padding: 0, textAlign: 'left',
                    fontSize: 13, fontWeight: 600, color: '#1d4ed8', cursor: 'pointer',
                    textDecoration: 'underline',
                }, children: a.title }), _jsxs("div", { style: { fontSize: 11, color: '#6b7280' }, children: [new Date(a.startTime).toLocaleString(), " \u2192 ", new Date(a.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), a.client && _jsxs(_Fragment, { children: [" \u00B7 ", a.client] }), a.technician && _jsxs(_Fragment, { children: [" \u00B7 ", a.technician] })] }), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [_jsx(CompleteTimePrompt, { a: a, onComplete: onMarkComplete }), _jsx("button", { onClick: () => onRequestCancel(a), style: cancelBtn, children: "\u2715 Cancel" })] })] }));
}
// ---------- Per-client card ----------
// "Within 2 percentage-points of the minimum" → Risky.
const RISKY_MARGIN = 2;
function getActualLevel(directHours, pct, targetPct, preferredPct, maxPct) {
    if (directHours === 0)
        return 'na';
    if (maxPct !== undefined && pct > maxPct)
        return 'reduce';
    if (pct >= preferredPct)
        return 'ideal';
    if (pct >= targetPct)
        return 'good';
    return 'behind';
}
function getProjectedLevel(directHours, pct, targetPct, preferredPct, maxPct) {
    if (directHours === 0)
        return 'behind';
    if (maxPct !== undefined && pct > maxPct)
        return 'overcap';
    if (pct >= preferredPct)
        return 'ideal';
    if (pct >= targetPct + RISKY_MARGIN)
        return 'ok';
    if (pct >= targetPct)
        return 'risky';
    return 'behind';
}
// Status badge for the ACTUAL supervision section.
function actualSectionStatus(level) {
    switch (level) {
        case 'na': return { text: 'N/A', color: '#6b7280' };
        case 'reduce': return { text: 'Over', color: CAP_OVER };
        case 'ideal': return { text: 'Ideal', color: '#166534' };
        case 'good': return { text: 'Good', color: '#15803d' };
        case 'behind': return { text: 'Behind', color: '#b91c1c' };
    }
}
function projectedSectionStatus(level) {
    switch (level) {
        case 'overcap': return { text: 'Over', color: CAP_OVER };
        case 'ideal': return { text: 'Ideal', color: '#166534' };
        case 'ok': return { text: 'OK', color: '#15803d' };
        case 'risky': return { text: 'Risky', color: '#b91c1c' };
        case 'behind': return { text: 'Behind', color: '#b91c1c' };
    }
}
// Overall card badge — hybrid of actual + projected.
function overallBadge(actual, projected, noDirect) {
    if (noDirect)
        return { text: 'Inactive', bgColor: '#6b7280', isCritical: false, isAmazing: false };
    // Both sides behind the minimum floor.
    if (actual === 'behind' && projected === 'behind')
        return { text: 'Critical', bgColor: '#b91c1c', cardBg: '#fff5f5', isCritical: true, isAmazing: false };
    // Any single side behind minimum (the other must not be, or Critical would have fired).
    if (actual === 'behind' || projected === 'behind')
        return { text: 'At Risk', bgColor: CAP_OVER, isCritical: false, isAmazing: false };
    // Over cap but projected barely above minimum → the risky trajectory is
    // the more actionable concern; the ⚠️ on the actual % already flags the cap.
    if (actual === 'reduce' && projected === 'risky')
        return { text: 'At Risk', bgColor: '#a16207', isCritical: false, isAmazing: false };
    // Both sides over insurer cap → financial problem in both views.
    if (actual === 'reduce' && projected === 'overcap')
        return { text: 'Reduce', bgColor: CAP_OVER, isCritical: false, isAmazing: false };
    // Projected barely above minimum (risky zone).
    if (projected === 'risky')
        return { text: 'At Risk', bgColor: '#a16207', isCritical: false, isAmazing: false };
    // Actual was ideal but projected drifts below ideal (regressing).
    if (actual === 'ideal' && projected === 'ok')
        return { text: 'At Risk', bgColor: '#a16207', isCritical: false, isAmazing: false };
    // Both at or above BCBA preferred.
    if (actual === 'ideal' && projected === 'ideal')
        return { text: '✨ Amazing', bgColor: '#15803d', cardBg: '#f0fdf4', isCritical: false, isAmazing: true };
    // Projected ideal but actual not yet (trending up), or both comfortably above min.
    return { text: 'Great', bgColor: '#15803d', isCritical: false, isAmazing: false };
}
function ClientCard({ report, targetPct, preferredPct, maxPct }) {
    const { client, actual, projected } = report;
    const noDirect = actual.directHours === 0 && projected.directHours === 0;
    const aLevel = getActualLevel(actual.directHours, actual.pct, targetPct, preferredPct, maxPct);
    const pLevel = getProjectedLevel(projected.directHours, projected.pct, targetPct, preferredPct, maxPct);
    const badge = overallBadge(aLevel, pLevel, noDirect);
    const actualStatus = actualSectionStatus(aLevel);
    const projStatus = projectedSectionStatus(pLevel);
    return (_jsxs("div", { style: {
            backgroundColor: badge.cardBg ?? 'white',
            border: `2px solid ${badge.bgColor}`,
            borderRadius: 8, padding: 12,
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, children: [_jsx("h3", { style: { fontSize: 15, fontWeight: 700, margin: 0 }, children: client.name }), _jsx("span", { style: {
                            fontSize: 11, fontWeight: 700,
                            textTransform: badge.isAmazing ? undefined : 'uppercase',
                            color: 'white', backgroundColor: badge.bgColor,
                            padding: '2px 10px', borderRadius: 10,
                            boxShadow: badge.isAmazing ? '0 0 0 2px #86efac' : undefined,
                        }, children: badge.text })] }), noDirect ? (_jsxs("p", { style: { fontSize: 12, color: '#6b7280', margin: 0 }, children: ["No direct sessions in ", monthLabel(report), ". Nothing to supervise."] })) : (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'start' }, children: [_jsx(Metric, { title: "Actual", m: actual, targetPct: targetPct, preferredPct: preferredPct, sectionStatus: actualStatus, maxPct: maxPct }), _jsx(Metric, { title: "Projected", m: projected, targetPct: targetPct, preferredPct: preferredPct, sectionStatus: projStatus, maxPct: maxPct })] }))] }));
}
function TechCard({ report, maxPct, contacts, rbtMinContacts, btMinContacts }) {
    const { tech, actual, projected } = report;
    const noDirect = actual.directHours === 0 && projected.directHours === 0;
    const minContacts = tech.isRBT ? (rbtMinContacts ?? 2) : (btMinContacts ?? 1);
    const contactsRequired = !noDirect ? minContacts : 0;
    const contactsBehind = contacts !== undefined && contactsRequired > 0 && contacts.projected < contactsRequired;
    const status = techStatus(actual, projected, tech.isRBT, noDirect);
    const overallStatus = (status === 'green' && contactsBehind) ? 'yellow'
        : (status === 'yellow' && contactsBehind) ? 'red'
            : status;
    const accent = statusColor(overallStatus);
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
                        }, children: statusLabel(overallStatus) })] }), noDirect ? (_jsx("p", { style: { fontSize: 12, color: '#6b7280', margin: 0 }, children: "No direct sessions this period. Nothing to supervise." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: [_jsx(TechMetric, { title: "Actual", m: actual, accent: accent, isRBT: tech.isRBT, maxPct: maxPct }), _jsx(TechMetric, { title: "Projected", m: projected, accent: accent, isRBT: tech.isRBT, maxPct: maxPct })] }), contacts !== undefined && contactsRequired > 0 && (_jsxs("div", { style: { marginTop: 8, fontSize: 12, color: '#6b7280' }, children: ["Supervision contacts: ", _jsxs("strong", { style: { color: contactsBehind ? accent : '#15803d' }, children: [contacts.actual, " actual / ", contacts.projected, " projected"] }), ' ', "(need ", contactsRequired, "/month)", contactsBehind && _jsx("span", { style: { color: accent, fontWeight: 600 }, children: " \u2014 behind" }), !contactsBehind && contacts.projected >= contactsRequired && _jsx("span", { style: { color: '#15803d' }, children: " \u2713" })] }))] }))] }));
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
    return (_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }, children: title }), _jsxs("div", { style: { fontSize: 18, fontWeight: 700, color: pctColor }, children: [m.pct.toFixed(1), "%", overCap && _jsx("span", { style: { fontSize: 14 }, children: " \u26A0\uFE0F" })] }), _jsx("div", { style: {
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
function Metric({ title, m, targetPct, preferredPct, sectionStatus, maxPct }) {
    const overCap = maxPct !== undefined && m.pct > maxPct;
    const fillPct = Math.min(100, (m.pct / targetPct) * 100);
    const { color: statusColor, text: statusText } = sectionStatus;
    const label = overCap ? `of ${maxPct}% max` : `of ${preferredPct}%`;
    return (_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 2 }, children: title }), _jsxs("div", { style: { display: 'flex', alignItems: 'baseline', gap: 5 }, children: [_jsxs("span", { style: { fontSize: 18, fontWeight: 700, color: statusColor }, children: [m.pct.toFixed(1), "%", overCap && _jsx("span", { style: { fontSize: 14 }, children: " \u26A0\uFE0F" })] }), _jsx("span", { style: { fontSize: 11, color: '#6b7280', fontWeight: 400 }, children: label })] }), _jsx("div", { style: { height: 22, display: 'flex', alignItems: 'center', marginTop: 3 }, children: _jsx("span", { style: {
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        color: 'white', backgroundColor: statusColor,
                        padding: '2px 7px', borderRadius: 8,
                    }, children: statusText }) }), _jsx("div", { style: { height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }, children: _jsx("div", { style: { height: '100%', width: `${fillPct}%`, backgroundColor: statusColor, transition: 'width 200ms' } }) }), _jsxs("div", { style: { fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }, children: ["Direct: ", _jsxs("strong", { children: [m.directHours.toFixed(1), "h"] }), " \u00B7 Sup: ", _jsxs("strong", { children: [m.supervisionHours.toFixed(1), "h"] }), _jsx("br", {}), "Required: ", _jsxs("strong", { children: [m.requiredHours.toFixed(1), "h"] }), m.hoursToGo > 0 && (_jsxs(_Fragment, { children: [" \u00B7 To go: ", _jsxs("strong", { style: { color: statusColor }, children: [m.hoursToGo.toFixed(1), "h"] })] })), m.hoursToGo === 0 && m.directHours > 0 && (_jsx(_Fragment, { children: " \u00B7 \u2713" }))] })] }));
}
function monthLabel(r) {
    // Just used in a display string; the metric carries enough context.
    return 'this period';
}
function statusLabel(s) {
    switch (s) {
        case 'green': return 'on track';
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
const cancelBtn = {
    flex: '1 1 auto', padding: '5px 9px',
    backgroundColor: '#fee2e2', color: '#b91c1c',
    border: '1px solid #fca5a5', borderRadius: 4,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
//# sourceMappingURL=ComplianceDashboard.js.map