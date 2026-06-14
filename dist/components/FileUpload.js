import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useRef } from 'react';
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
                    padding: '5px 9px',
                    backgroundColor: loading ? '#d1d5db' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: 5,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2,
                }, children: loading ? '…' : 'Upload' })] }));
}
//# sourceMappingURL=FileUpload.js.map