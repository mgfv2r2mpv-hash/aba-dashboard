import React, { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  error?: string | null;
  // The second front door. Absent means the portal can only open an existing
  // backup, which is what it could do before setup existed.
  onStartSetup?: () => void;
}

export default function UploadZone({ onFile, error, onStartSetup }: Props) {
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
        <p>Build, edit, and re-download your schedule &nbsp;·&nbsp; Everything happens in your browser</p>
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
          accept=".json,.sassi"
          onChange={onChange}
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: 'none' }}
        />
        <span className="drop-zone-icon">🔒</span>
        <span className="drop-zone-label">Drop encrypted schedule file</span>
        <span className="drop-zone-sublabel">
          or tap to browse &nbsp;·&nbsp; <code>.sassi</code> backup (legacy <code>.enc.json</code> works too)
        </span>
      </label>

      {error && (
        <div className="error-banner" role="alert" aria-live="assertive">
          <strong>Cannot open file:</strong> {error}
        </div>
      )}

      {onStartSetup && (
        <div className="upload-alt">
          <span className="upload-alt-rule" aria-hidden="true" />
          <span className="upload-alt-word">or</span>
          <span className="upload-alt-rule" aria-hidden="true" />
        </div>
      )}

      {onStartSetup && (
        <button type="button" className="start-fresh" onClick={onStartSetup}>
          <span className="start-fresh-icon" aria-hidden="true">✨</span>
          <span className="start-fresh-label">Start a new schedule</span>
          <span className="start-fresh-sublabel">
            Enter your cases and staff, and SAssi builds the week
          </span>
        </button>
      )}

      <p className="upload-hint">
        Uploads accept files exported with a schedule password set. Decryption and scheduling both
        run entirely in your browser. Asking the assistant is the one thing that leaves it, and it
        leaves with every name already replaced by an opaque token.
      </p>
    </div>
  );
}
