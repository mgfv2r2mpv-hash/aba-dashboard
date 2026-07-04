import React, { useRef } from 'react';

interface FileUploadProps {
  onUpload: (file: File) => void;
  loading: boolean;
}

export default function FileUpload({ onUpload, loading }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: '5px 9px',
          backgroundColor: loading ? 'var(--slate-300)' : 'var(--brand-primary)',
          color: 'white',
          border: 'none',
          borderRadius: 5,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          lineHeight: 1.2,
        }}
      >
        {loading ? '…' : 'Upload'}
      </button>
    </>
  );
}
