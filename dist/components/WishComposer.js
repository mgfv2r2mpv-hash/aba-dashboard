import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { ClaudeScheduler } from '../claudeScheduler';
import { summarizeWish, wishSolutionToDraft } from '../wish';
const KINDS = [
    { value: 'vacation', label: 'Plan time away', blurb: 'Block a date range and reschedule my sessions around it.' },
    { value: 'clearWindow', label: 'Clear a recurring window', blurb: 'Free up a weekday/time going forward (e.g. Friday evenings).' },
    { value: 'addRecurring', label: 'Add a recurring session', blurb: 'Fit a new repeating session into a tight schedule.' },
    { value: 'shaveDown', label: 'Trim over-served sessions', blurb: 'Shave supervision hours toward the minimum to free up capacity.' },
    { value: 'freeform', label: 'Something else', blurb: 'Describe it in your own words.' },
];
const CONTEXT_TOOLTIP = `Be specific: mention affected clients by name, days to avoid, session types to add or remove, and any hard constraints (e.g. "keep Tuesday 9–11 free"). The more detail, the better the AI result.`;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const APPT_TYPES = [
    { v: 'parent-training', l: 'Parent Training' }, { v: 'supervision', l: 'Supervision' },
    { v: 'case-planning', l: 'Case Planning' }, { v: 'client-session', l: 'Client Session' },
    { v: 'reassessment', l: 'Reassessment' }, { v: 'other', l: 'Other' },
];
const inputStyle = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box' };
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#374151' };
function opText(o) {
    const t = (iso) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    switch (o.op) {
        case 'move': return `Move ${o.appointmentId.slice(0, 6)} → ${t(o.start)}–${t(o.end)}`;
        case 'remove': return `Remove ${o.appointmentId.slice(0, 6)}`;
        case 'add': return `Add ${o.title || o.type}${o.client ? ` for ${o.client}` : ''} ${t(o.start)}${o.recurring ? ` (${o.pattern || 'weekly'})` : ''}`;
        case 'blackout': return `Block ${o.entity} on ${o.date}${o.reason ? ` — ${o.reason}` : ''}`;
    }
}
const DEFAULT_HORIZON = 4;
export default function WishComposer({ data, aiSettings, onAccept, onCustomize, onClose }) {
    const [wish, setWish] = useState({ kind: 'vacation', horizonWeeks: DEFAULT_HORIZON });
    const [horizonText, setHorizonText] = useState(String(DEFAULT_HORIZON));
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [solutions, setSolutions] = useState(null);
    const upd = (patch) => setWish(w => ({ ...w, ...patch }));
    const generate = async () => {
        if (!aiSettings.apiKey) {
            setError('Add your Claude API key in Settings first.');
            return;
        }
        setLoading(true);
        setError(null);
        setSolutions(null);
        try {
            const scheduler = new ClaudeScheduler(aiSettings.apiKey, data, aiSettings.model);
            const sols = await scheduler.generateWishSolutions(wish);
            setSolutions(sols);
        }
        catch (e) {
            setError(e?.message || String(e));
        }
        finally {
            setLoading(false);
        }
    };
    const overlay = {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
        boxSizing: 'border-box',
    };
    return (_jsx("div", { style: overlay, children: _jsxs("div", { style: { background: 'white', borderRadius: 10, padding: 20, width: '100%', maxWidth: 560, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, children: [_jsx("h2", { style: { fontSize: 20, fontWeight: 700, margin: 0 }, children: "\u2728 Wish It" }), _jsx("button", { onClick: onClose, style: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }, children: "\u2715" })] }), _jsx("p", { style: { fontSize: 13, color: '#6b7280', marginTop: 0 }, children: "Describe a goal; the AI proposes up to 3 compliant ways to reshape your schedule. Pick one to apply or customize." }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: [_jsxs("label", { style: labelStyle, children: ["What do you want to do?", _jsx("select", { value: wish.kind, onChange: e => setWish({ kind: e.target.value, horizonWeeks: wish.horizonWeeks }), style: inputStyle, children: KINDS.map(k => _jsx("option", { value: k.value, children: k.label }, k.value)) }), _jsx("span", { style: { fontWeight: 400, color: '#6b7280' }, children: KINDS.find(k => k.value === wish.kind)?.blurb })] }), wish.kind === 'vacation' && (_jsxs("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap' }, children: [_jsxs("label", { style: { ...labelStyle, flex: '1 1 150px' }, children: ["From", _jsx("input", { type: "date", value: wish.dateStart || '', onChange: e => upd({ dateStart: e.target.value }), style: inputStyle })] }), _jsxs("label", { style: { ...labelStyle, flex: '1 1 150px' }, children: ["To", _jsx("input", { type: "date", value: wish.dateEnd || '', onChange: e => upd({ dateEnd: e.target.value }), style: inputStyle })] })] })), (wish.kind === 'clearWindow' || wish.kind === 'addRecurring') && (_jsxs("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap' }, children: [_jsxs("label", { style: { ...labelStyle, flex: '1 1 120px' }, children: ["Day", _jsx("select", { value: wish.weekday || 'Friday', onChange: e => upd({ weekday: e.target.value }), style: inputStyle, children: WEEKDAYS.map(d => _jsx("option", { value: d, children: d }, d)) })] }), _jsxs("label", { style: { ...labelStyle, flex: '1 1 100px' }, children: [wish.kind === 'addRecurring' ? 'Around' : 'From', _jsx("input", { type: "time", value: wish.windowStart || '', onChange: e => upd({ windowStart: e.target.value }), style: inputStyle })] }), wish.kind === 'clearWindow' && (_jsxs("label", { style: { ...labelStyle, flex: '1 1 100px' }, children: ["To", _jsx("input", { type: "time", value: wish.windowEnd || '', onChange: e => upd({ windowEnd: e.target.value }), style: inputStyle })] }))] })), wish.kind === 'clearWindow' && (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }, children: [_jsx("input", { type: "checkbox", checked: !!wish.everyOtherWeek, onChange: e => upd({ everyOtherWeek: e.target.checked }) }), "Every other week (e.g. custody Fridays)"] })), wish.kind === 'addRecurring' && (_jsxs("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap' }, children: [_jsxs("label", { style: { ...labelStyle, flex: '1 1 150px' }, children: ["Type", _jsx("select", { value: wish.newType || 'parent-training', onChange: e => upd({ newType: e.target.value }), style: inputStyle, children: APPT_TYPES.map(t => _jsx("option", { value: t.v, children: t.l }, t.v)) })] }), _jsxs("label", { style: { ...labelStyle, flex: '1 1 150px' }, children: ["Client (optional)", _jsxs("select", { value: wish.client || '', onChange: e => upd({ client: e.target.value || undefined }), style: inputStyle, children: [_jsx("option", { value: "", children: "\u2014 none \u2014" }), data.clients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] })] }), _jsxs("label", { style: { ...labelStyle, flex: '1 1 100px' }, children: ["Minutes", _jsx("input", { type: "number", min: "15", step: "15", value: wish.durationMins ?? 60, onChange: e => upd({ durationMins: parseInt(e.target.value) || 60 }), style: inputStyle })] })] })), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#374151' }, children: [_jsx("span", { children: wish.kind === 'freeform' ? 'Describe your goal' : 'Anything else? (optional)' }), _jsx("span", { role: "button", tabIndex: 0, onClick: () => setTooltipVisible(v => !v), onKeyDown: e => e.key === 'Enter' && setTooltipVisible(v => !v), style: { cursor: 'pointer', color: '#6b7280', fontSize: 11, border: '1px solid #d1d5db', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, userSelect: 'none' }, children: "?" })] }), tooltipVisible && (_jsx("div", { style: { fontSize: 12, color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 }, children: CONTEXT_TOOLTIP })), _jsx("textarea", { value: wish.note || '', onChange: e => upd({ note: e.target.value.slice(0, 400) }), rows: wish.kind === 'freeform' ? 3 : 2, maxLength: 400, placeholder: wish.kind === 'freeform' ? 'e.g. end by 4pm on Wednesdays, and keep a 12–1 lunch hole daily' : 'extra detail to guide the AI', style: { ...inputStyle, resize: 'vertical' } }), _jsxs("span", { style: { fontSize: 11, color: (wish.note?.length ?? 0) >= 380 ? '#b91c1c' : '#9ca3af', textAlign: 'right' }, children: [wish.note?.length ?? 0, "/400"] })] }), _jsxs("label", { style: { ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }, children: ["Look ahead", _jsx("input", { type: "number", min: "1", max: "26", value: horizonText, onChange: e => {
                                        setHorizonText(e.target.value);
                                        const n = parseInt(e.target.value);
                                        if (!isNaN(n) && n >= 1)
                                            upd({ horizonWeeks: Math.min(26, n) });
                                    }, onBlur: () => {
                                        const n = parseInt(horizonText);
                                        const clamped = isNaN(n) || n < 1 ? DEFAULT_HORIZON : Math.min(26, n);
                                        setHorizonText(String(clamped));
                                        upd({ horizonWeeks: clamped });
                                    }, style: { ...inputStyle, width: 70 } }), "weeks"] }), _jsxs("div", { style: { background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#5b21b6' }, children: [_jsx("strong", { children: "Wish:" }), " ", summarizeWish(wish)] })] }), error && _jsx("div", { style: { color: '#b91c1c', fontSize: 13, marginTop: 10 }, children: error }), solutions && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 8 }, children: solutions.length > 0 ? `${solutions.length} option${solutions.length === 1 ? '' : 's'}` : 'No compliant options found' }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: solutions.map((sol, i) => {
                                const d = wishSolutionToDraft(sol, data);
                                return (_jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }, children: [_jsxs("div", { style: { fontWeight: 700, fontSize: 14, color: '#111827' }, children: ["Option ", i + 1, ": ", sol.summary] }), sol.reasoning && _jsx("div", { style: { fontSize: 12, color: '#6b7280', marginTop: 2 }, children: sol.reasoning }), _jsx("ul", { style: { margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#374151' }, children: sol.ops.map((o, j) => _jsx("li", { children: opText(o) }, j)) }), d.unresolved > 0 && _jsxs("div", { style: { fontSize: 11, color: '#b45309', marginTop: 4 }, children: [d.unresolved, " change(s) referenced something not found and will be skipped."] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => onAccept(sol), style: { padding: '6px 14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }, children: "Accept" }), _jsx("button", { onClick: () => onCustomize(sol), style: { padding: '6px 14px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }, children: "Customize" })] })] }, sol.id));
                            }) })] })), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }, children: [_jsx("button", { onClick: onClose, style: { padding: '8px 16px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }, children: "Cancel" }), _jsx("button", { onClick: generate, disabled: loading, style: { padding: '8px 16px', background: loading ? '#a78bfa' : '#7c3aed', color: 'white', border: 'none', borderRadius: 6, cursor: loading ? 'default' : 'pointer', fontWeight: 600 }, children: loading ? 'Thinking…' : solutions ? 'Regenerate' : 'Generate options' })] })] }) }));
}
//# sourceMappingURL=WishComposer.js.map