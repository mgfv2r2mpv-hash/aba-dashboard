import React, { useCallback, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  error?: string | null;
}

export default function UploadZone({ onFile, error }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  }, [onFile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, width: '100%', maxWidth: 480, minHeight: 200,
          border: `2px dashed ${dragging ? '#3b82f6' : '#d1d5db'}`,
          borderRadius: 12, padding: 32, cursor: 'pointer',
          backgroundColor: dragging ? '#eff6ff' : 'white',
          transition: 'all 0.15s',
        }}
      >
        <input type="file" accept=".xlsx" onChange={handleChange} style={{ display: 'none' }} />
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
            Drop encrypted schedule file here
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            or click to browse — accepts <code style={{ fontFamily: 'monospace' }}>.enc.xlsx</code> only
          </div>
        </div>
      </label>

      {error && (
        <div style={{
          width: '100%', maxWidth: 480, padding: '12px 16px',
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 8, color: '#991b1b', fontSize: 13, lineHeight: 1.5,
        }}>
          <strong>Cannot open file:</strong> {error}
        </div>
      )}

      <div style={{ maxWidth: 480, fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: 1.6 }}>
        To protect patient privacy, this portal only accepts files exported from the ABA
        Dashboard app with a schedule password set. The file is decrypted entirely in your
        browser — no data is sent to any server.
      </div>
    </div>
  );
}
