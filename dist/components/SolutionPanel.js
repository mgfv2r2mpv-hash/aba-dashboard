import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
export default function SolutionPanel({ solutions, onApply }) {
    const [expanded, setExpanded] = useState(0);
    return (_jsxs("div", { style: { padding: '16px', overflow: 'auto', flex: 1 }, children: [_jsx("h3", { style: { marginBottom: '12px' }, children: "\uD83D\uDCA1 Suggested Solutions" }), solutions.map((solution, idx) => (_jsxs("div", { style: {
                    marginBottom: '12px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #10b981',
                    borderRadius: '6px',
                    overflow: 'hidden',
                }, children: [_jsxs("button", { onClick: () => setExpanded(expanded === idx ? -1 : idx), style: {
                            width: '100%',
                            padding: '12px',
                            backgroundColor: idx === expanded ? '#d1fae5' : 'transparent',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontWeight: '600',
                        }, children: [_jsxs("span", { children: ["Solution ", idx + 1, ": ", solution.affectedWeeks === 1 ? '1 week' : `${solution.affectedWeeks} weeks`] }), _jsx("span", { children: expanded === idx ? '▼' : '▶' })] }), expanded === idx && (_jsxs("div", { style: { padding: '12px', borderTop: '1px solid #10b981' }, children: [solution.affectedWeeks > 1 && (_jsxs("div", { style: {
                                    marginBottom: '12px',
                                    padding: '8px 10px',
                                    backgroundColor: '#fef3c7',
                                    border: '1px solid #f59e0b',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    color: '#92400e',
                                }, children: ["\u26A0\uFE0F This solution spans ", solution.affectedWeeks, " weeks", solution.weekSpan && (_jsxs(_Fragment, { children: [" (", solution.weekSpan.startDate, " to ", solution.weekSpan.endDate, ")"] })), ". Review changes carefully before applying."] })), _jsxs("div", { style: { marginBottom: '12px' }, children: [_jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginBottom: '4px' }, children: _jsx("strong", { children: "Reasoning:" }) }), _jsx("p", { style: { fontSize: '13px', lineHeight: '1.5', color: '#374151' }, children: solution.reasoning })] }), solution.changes.length > 0 && (_jsxs("div", { style: { marginBottom: '12px' }, children: [_jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: '600' }, children: "Changes:" }), solution.changes.map((change, cidx) => (_jsxs("div", { style: { fontSize: '12px', color: '#374151', marginBottom: '8px' }, children: [_jsxs("p", { children: ["\u2022 ", _jsx("strong", { children: change.appointmentId })] }), _jsxs("p", { style: { marginLeft: '16px' }, children: [change.oldTime.start, " \u2192 ", change.newTime.start] })] }, cidx)))] })), _jsx("button", { onClick: () => onApply(solution), style: {
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: '600',
                                    fontSize: '13px',
                                }, children: "Apply This Solution" })] }))] }, solution.id)))] }));
}
//# sourceMappingURL=SolutionPanel.js.map