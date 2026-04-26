import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from 'react';
export default function FileUpload({ onUpload, loading }) {
    const fileInputRef = useRef(null);
    const handleClick = () => {
        fileInputRef.current?.click();
    };
    const handleChange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            onUpload(file);
        }
    };
    return (_jsxs(_Fragment, { children: [_jsx("input", { ref: fileInputRef, type: "file", accept: ".xlsx", onChange: handleChange, style: { display: 'none' } }), _jsx("button", { onClick: handleClick, disabled: loading, style: {
                    padding: '8px 16px',
                    backgroundColor: loading ? '#d1d5db' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                }, children: loading ? 'Loading...' : 'Upload Schedule' })] }));
}
//# sourceMappingURL=FileUpload.js.map