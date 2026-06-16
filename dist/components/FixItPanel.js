import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
import { DEFAULT_FIXIT_OPTIONS } from '../types';
import { ClaudeScheduler } from '../claudeScheduler';
import { summarizeFixIt } from '../fixit';
import { wishSolutionToDraft } from '../wish';
const TOGGLES = [
    { key: 'includeBtSupervision', label: 'Include BT supervision' },
    { key: 'includeNoBtSupervision', label: 'Include no-BT supervision' },
    { key: 'includeInSessionParentTraining', label: 'Include in-session parent training' },
    { key: 'includeOutSessionParentTraining', label: 'Include out-session parent training' },
    { key: 'includeCasePlanning', label: 'Include case planning' },
    { key: 'softenBillableMinimum', label: 'Soften billable minimum requirement' },
];
const PRIORITY_TOGGLES = [
    { key: 'prioritizeBtSupervision', label: 'Prioritize BT supervision' },
    { key: 'prioritizeParentTraining', label: 'Prioritize parent training' },
];
function opText(o) {
    const t = (iso) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    switch (o.op) {
        case 'move': return `Move ${o.appointmentId.slice(0, 6)} → ${t(o.start)}–${t(o.end)}`;
        case 'remove': return `Remove ${o.appointmentId.slice(0, 6)}`;
        case 'add': return `Add ${o.title || o.type}${o.client ? ` for ${o.client}` : ''} ${t(o.start)}${o.recurring ? ` (${o.pattern || 'weekly'})` : ''}`;
        case 'blackout': return `Block ${o.entity} on ${o.date}${o.reason ? ` — ${o.reason}` : ''}`;
    }
}
export default function FixItPanel({ data, aiSettings, conflicts, onAccept, onCustomize }) {
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState({ ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [solutions, setSolutions] = useState(null);
    // "Object": a feedback note folded into a regenerate request.
    const [objecting, setObjecting] = useState(false);
    const [objection, setObjection] = useState('');
    const [showPromptPreview, setShowPromptPreview] = useState(false);
    const [previewPrompt, setPreviewPrompt] = useState('');
    const [copyFlash, setCopyFlash] = useState(false);
    const previewTextRef = useRef(null);
    const copyTimeoutRef = useRef(null);
    const toggle = (key) => setOptions(o => ({ ...o, [key]: !o[key] }));
    const excluded = new Set(options.excludedClientIds);
    const toggleClient = (id) => setOptions(o => {
        const set = new Set(o.excludedClientIds);
        if (set.has(id))
            set.delete(id);
        else
            set.add(id);
        return { ...o, excludedClientIds: [...set] };
    });
    const excludeAllClients = () => setOptions(o => ({ ...o, excludedClientIds: data.clients.map(c => c.id) }));
    const includeAllClients = () => setOptions(o => ({ ...o, excludedClientIds: [] }));
    const generate = async (extraNote) => {
        if (!aiSettings.apiKey) {
            setError('Add your Claude API key in Admin → Settings first.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const conflictMsgs = conflicts.map(c => c.message);
            if (extraNote && extraNote.trim())
                conflictMsgs.push(`BCBA feedback on the prior options: ${extraNote.trim()}`);
            const scheduler = new ClaudeScheduler(aiSettings.apiKey, data, aiSettings.model);
            const sols = await scheduler.generateFixSolutions(options, conflictMsgs);
            setSolutions(sols);
            setObjecting(false);
            setObjection('');
        }
        catch (e) {
            setError(e?.message || String(e));
        }
        finally {
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
    return (_jsxs("div", { style: {
            border: '1px solid #fdba74', backgroundColor: '#fff7ed',
            borderRadius: 8, marginBottom: 16, overflow: 'hidden',
        }, children: [_jsxs("button", { onClick: () => setOpen(o => !o), style: {
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 15, fontWeight: 700, color: '#9a3412', textAlign: 'left',
                }, children: [_jsx("span", { children: "\uD83D\uDD27 Fix It \u2014 AI compliance remediation" }), _jsx("span", { children: open ? '▾' : '▸' })] }), showPromptPreview && (_jsx("div", { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }, children: _jsxs("div", { style: { background: 'white', borderRadius: 10, padding: 20, width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, children: [_jsx("strong", { style: { fontSize: 15 }, children: "AI Prompt Preview" }), _jsx("button", { onClick: () => setShowPromptPreview(false), style: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }, children: "\u2715" })] }), _jsx("textarea", { ref: previewTextRef, readOnly: true, value: previewPrompt, style: { flex: 1, fontFamily: 'monospace', fontSize: 11, padding: 10, border: '1px solid #d1d5db', borderRadius: 6, resize: 'none', overflowY: 'auto' } }), _jsx("button", { onClick: () => {
                                navigator.clipboard.writeText(previewPrompt).catch(() => { });
                                setCopyFlash(true);
                                if (copyTimeoutRef.current)
                                    clearTimeout(copyTimeoutRef.current);
                                copyTimeoutRef.current = setTimeout(() => setCopyFlash(false), 2000);
                            }, style: { marginTop: 10, padding: '7px 14px', background: copyFlash ? '#15803d' : '#ea580c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end', transition: 'background 0.2s' }, children: copyFlash ? '✓ Copied!' : 'Copy to clipboard' })] }) })), open && (_jsxs("div", { style: { padding: '0 14px 14px' }, children: [_jsx("p", { style: { fontSize: 12, color: '#9a3412', marginTop: 0 }, children: "Pick which clinical tools the AI may use and any clients to leave out, then generate up to 3 compliant ways to close your supervision and parent-training gaps." }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, marginBottom: 8 }, children: TOGGLES.map(t => (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: !!options[t.key], onChange: () => toggle(t.key) }), t.label] }, t.key))) }), _jsx("div", { style: { display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }, children: PRIORITY_TOGGLES.map(t => (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b21a8', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: !!options[t.key], onChange: () => toggle(t.key) }), t.label] }, t.key))) }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }, children: [_jsxs("span", { style: { fontSize: 12, fontWeight: 700, color: '#374151' }, children: ["Clients to consider (", data.clients.length - excluded.size, " of ", data.clients.length, ")"] }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("button", { onClick: excludeAllClients, disabled: excluded.size === data.clients.length, style: { ...miniBtn, opacity: excluded.size === data.clients.length ? 0.45 : 1 }, children: "Uncheck all" }), _jsx("button", { onClick: includeAllClients, disabled: excluded.size === 0, style: { ...miniBtn, opacity: excluded.size === 0 ? 0.45 : 1 }, children: "Check all" })] })] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 4, maxHeight: 160, overflowY: 'auto' }, children: data.clients.map(c => (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: !excluded.has(c.id), onChange: () => toggleClient(c.id) }), c.name] }, c.id))) }), _jsx("p", { style: { fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }, children: "Checked clients are included; unchecked are left out of the calculation." })] }), _jsxs("div", { style: { background: '#ffedd5', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#9a3412', marginBottom: 12 }, children: [_jsx("strong", { children: "Plan:" }), " ", summarizeFixIt(options, data.clients)] }), error && _jsx("div", { style: { color: '#b91c1c', fontSize: 13, marginBottom: 10 }, children: error }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }, children: [_jsx("button", { onClick: () => generate(), disabled: loading || !anyStrategy, style: {
                                    padding: '8px 16px', background: loading || !anyStrategy ? '#fdba74' : '#ea580c', color: 'white',
                                    border: 'none', borderRadius: 6, cursor: loading || !anyStrategy ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
                                }, children: loading ? 'Thinking…' : solutions ? 'Regenerate' : 'Generate solutions' }), _jsx("button", { onClick: openPromptPreview, title: "Preview AI prompt", style: { ...miniBtn, fontSize: 14, padding: '7px 10px' }, children: "\uD83D\uDD0D" }), !anyStrategy && _jsx("span", { style: { fontSize: 12, color: '#9a3412', alignSelf: 'center' }, children: "Select at least one strategy." })] }), solutions && (_jsxs("div", { style: { marginTop: 8 }, children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#9a3412', marginBottom: 8 }, children: solutions.length > 0 ? `${solutions.length} proposed option${solutions.length === 1 ? '' : 's'}` : 'No compliant options within the selected strategies' }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: solutions.map((sol, i) => {
                                    const d = wishSolutionToDraft(sol, data);
                                    return (_jsxs("div", { style: { border: '1px solid #fed7aa', background: 'white', borderRadius: 8, padding: 12 }, children: [_jsxs("div", { style: { fontWeight: 700, fontSize: 14, color: '#111827' }, children: ["Option ", i + 1, ": ", sol.summary] }), sol.reasoning && _jsx("div", { style: { fontSize: 12, color: '#6b7280', marginTop: 2 }, children: sol.reasoning }), sol.ops.length > 0 && (_jsx("ul", { style: { margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#374151' }, children: sol.ops.map((o, j) => _jsx("li", { children: opText(o) }, j)) })), d.unresolved > 0 && _jsxs("div", { style: { fontSize: 11, color: '#b45309', marginTop: 4 }, children: [d.unresolved, " change(s) referenced something not found and will be skipped."] }), sol.ops.length > 0 && (_jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => onAccept(sol), style: { padding: '6px 14px', background: '#ea580c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }, children: "Accept" }), _jsx("button", { onClick: () => onCustomize(sol), style: { padding: '6px 14px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }, children: "Customize & accept" })] }))] }, sol.id));
                                }) }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => setObjecting(o => !o), style: miniBtn, children: "Object\u2026" }), _jsx("button", { onClick: reject, style: { ...miniBtn, color: '#b91c1c', borderColor: '#fca5a5' }, children: "Reject these options" })] }), objecting && (_jsxs("div", { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }, children: [_jsx("textarea", { value: objection, onChange: e => setObjection(e.target.value.slice(0, 400)), maxLength: 400, rows: 2, placeholder: "What's wrong with these options? e.g. don't touch Tuesday mornings; prefer adding rather than moving.", style: { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, resize: 'vertical' } }), _jsxs("span", { style: { fontSize: 11, color: objection.length >= 380 ? '#b91c1c' : '#9ca3af', textAlign: 'right' }, children: [objection.length, "/400"] }), _jsx("div", { children: _jsx("button", { onClick: () => generate(objection), disabled: loading || !objection.trim(), style: {
                                                padding: '6px 14px', background: loading || !objection.trim() ? '#fdba74' : '#ea580c', color: 'white',
                                                border: 'none', borderRadius: 6, cursor: loading || !objection.trim() ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
                                            }, children: "Regenerate with feedback" }) })] }))] }))] }))] }));
}
const miniBtn = {
    padding: '5px 10px', background: 'white', color: '#374151',
    border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
//# sourceMappingURL=FixItPanel.js.map