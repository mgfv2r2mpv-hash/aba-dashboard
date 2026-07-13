import React, { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  error?: string | null;
}

export default function UploadZone({ onFile, error }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const process = useCallback((file: File) => { if (file) onFile(file); }, [onFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) process(file);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) process(file);
    e.target.value = '';
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className="upload-screen">
      <div className="upload-hero">
        <h1>ABA Dashboard <span style={{ color: 'var(--c-primary)' }}>Portal</span></h1>
        <p>Decrypt, edit, and re-download your schedule &nbsp;·&nbsp; Everything happens in your browser</p>
      </div>

      <label
        className={`drop-zone${dragging ? ' dragging' : ''}`}
        tabIndex={0}
        role="button"
        aria-label="Upload encrypted schedule file"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          onChange={onChange}
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: 'none' }}
        />
        <span className="drop-zone-icon">🔒</span>
        <span className="drop-zone-label">Drop encrypted schedule file</span>
        <span className="drop-zone-sublabel">
          or tap to browse &nbsp;·&nbsp; <code>.enc.json</code> backup
        </span>
      </label>

      {error && (
        <div className="error-banner" role="alert" aria-live="assertive">
          <strong>Cannot open file:</strong> {error}
        </div>
      )}

      <p className="upload-hint">
        This portal only accepts files exported from the ABA Dashboard app with a schedule
        password set. No data is sent to any server — decryption runs entirely in your browser.
      </p>
    </div>
  );
}
