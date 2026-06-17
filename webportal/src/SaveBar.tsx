import React from 'react';

export default function SaveBar({
  isDirty,
  isSaving,
  error,
  onSave,
}: {
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  if (!isDirty && !isSaving && !error) return null;

  return (
    <div className="save-bar" role="status" aria-live="polite">
      <span className="save-bar-msg">
        {isSaving
          ? 'Encrypting and preparing download…'
          : error
          ? error
          : 'You have unsaved changes.'}
      </span>
      <button
        className="btn-primary save-bar-btn"
        onClick={onSave}
        disabled={isSaving}
        aria-label="Download encrypted schedule"
      >
        {isSaving ? 'Saving…' : '↓ Download'}
      </button>
    </div>
  );
}
