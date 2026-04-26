import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
export default function ConflictPanel({ conflicts }) {
    const errorCount = conflicts.filter(c => c.severity === 'error').length;
    const warningCount = conflicts.filter(c => c.severity === 'warning').length;
    const getIcon = (severity) => {
        switch (severity) {
            case 'error':
                return '❌';
            case 'warning':
                return '⚠️';
            default:
                return 'ℹ️';
        }
    };
    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'error':
                return '#dc2626';
            case 'warning':
                return '#f59e0b';
            default:
                return '#3b82f6';
        }
    };
    return (_jsxs("div", { style: { padding: '16px', borderBottom: '1px solid #e5e7eb' }, children: [_jsxs("h3", { style: { marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }, children: ["Issues Found", errorCount > 0 && _jsxs("span", { style: { color: '#dc2626', fontWeight: 'bold' }, children: ["(", errorCount, " errors)"] }), warningCount > 0 && _jsxs("span", { style: { color: '#f59e0b', fontWeight: 'bold' }, children: ["(", warningCount, " warnings)"] })] }), _jsx("div", { style: { maxHeight: '300px', overflowY: 'auto' }, children: conflicts.map((conflict, idx) => (_jsxs("div", { style: {
                        padding: '12px',
                        marginBottom: '8px',
                        backgroundColor: conflict.severity === 'error' ? '#fee2e2' : '#fef3c7',
                        border: `1px solid ${getSeverityColor(conflict.severity)}`,
                        borderRadius: '6px',
                        fontSize: '12px',
                    }, children: [_jsxs("div", { style: { marginBottom: '4px', fontWeight: 'bold', display: 'flex', gap: '4px' }, children: [_jsx("span", { children: getIcon(conflict.severity) }), _jsx("span", { children: conflict.type })] }), _jsx("p", { style: { color: '#374151' }, children: conflict.message })] }, idx))) })] }));
}
//# sourceMappingURL=ConflictPanel.js.map