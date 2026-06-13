import React, { useState } from 'react';

export type ClaudeModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

export interface AISettings {
  apiKey: string;
  model: ClaudeModel;
  // Optional whole-file password. When set, downloaded schedules are encrypted
  // with it (opaque in a file browser) and re-import prompts for it. Held in
  // session only — never written into the file.
  schedulePassword?: string;
}

// App-lock controls, passed only on native platforms.
export interface LockControls {
  faceIdAvailable: boolean;
  faceIdEnabled: boolean;
  onChangePin: () => void;
  onToggleFaceId: (on: boolean) => void;
}

interface SettingsProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
  onClearKey: () => void;
  lock?: LockControls;
}

const MODEL_OPTIONS: { value: ClaudeModel; label: string; description: string }[] = [
  {
    value: 'claude-opus-4-7',
    label: 'Opus 4.7',
    description: 'Best for complex multi-week scheduling. Slower, more expensive.',
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: 'Balanced quality, speed, and cost. Recommended for most cases.',
  },
  {
    value: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    description: 'Fastest and cheapest. Good for simple single-week conflicts.',
  },
];

export default function Settings({ settings, onSave, onClose, onClearKey, lock }: SettingsProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState<ClaudeModel>(settings.model);
  const [showKey, setShowKey] = useState(false);

  // Schedule (file) password. Once set it is never shown again — changing it
  // requires the current password, since it's the only key to already-exported
  // encrypted files. A wrong "current" would orphan that data, so we gate it.
  const hasExistingPw = !!settings.schedulePassword;
  const [changingPw, setChangingPw] = useState(!hasExistingPw);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const handleSave = () => {
    let schedulePassword = settings.schedulePassword;
    if (changingPw) {
      if (hasExistingPw && currentPw !== settings.schedulePassword) {
        setPwError('Current password is incorrect.');
        return;
      }
      schedulePassword = newPw.trim() || undefined;
    }
    onSave({ apiKey: apiKey.trim(), model, schedulePassword });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '20px',
        width: '100%',
        maxWidth: 500,
        maxHeight: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>AI Settings</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Model Toggle */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>Claude Model</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {MODEL_OPTIONS.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  gap: '10px',
                  padding: '10px',
                  border: model === opt.value ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: model === opt.value ? '#eff6ff' : 'white',
                }}
              >
                <input
                  type="radio"
                  name="model"
                  value={opt.value}
                  checked={model === opt.value}
                  onChange={() => setModel(opt.value)}
                  style={{ marginTop: '4px' }}
                />
                <div>
                  <div style={{ fontWeight: '600' }}>{opt.label}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* API Key Input */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
            Claude API Key
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            Your key stays in this browser session. It is sent per-request via header and never stored on the server.
          </p>
          {settings.apiKey && (
            <button
              onClick={() => { onClearKey(); setApiKey(''); }}
              style={{
                marginTop: '8px',
                padding: '6px 12px',
                background: '#fee2e2',
                color: '#dc2626',
                border: '1px solid #fca5a5',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Clear stored key
            </button>
          )}
        </div>

        {/* Schedule password (whole-file encryption) */}
        <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
            Schedule Password (optional)
          </label>
          <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
            Encrypts your downloaded schedule file. Opening it anywhere — including
            in this app on another device — requires this password. Leave blank to
            download a normal, readable file.
          </p>

          {hasExistingPw && !changingPw ? (
            // Never re-display a set password. Offer a guarded change instead.
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', color: '#374151' }}>🔒 Password is set.</span>
              <button
                onClick={() => { setChangingPw(true); setPwError(null); }}
                style={{
                  padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                  background: 'white', cursor: 'pointer', fontSize: '13px',
                }}
              >
                Change…
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {hasExistingPw && (
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="Current password"
                  value={currentPw}
                  onChange={(e) => { setCurrentPw(e.target.value); setPwError(null); }}
                  autoComplete="off"
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                />
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder={hasExistingPw ? 'New password (blank to remove)' : 'Leave blank for no encryption'}
                  value={newPw}
                  onChange={(e) => { setNewPw(e.target.value); setPwError(null); }}
                  autoComplete="off"
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                />
                <button
                  onClick={() => setShowPw(!showPw)}
                  style={{
                    padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                    background: 'white', cursor: 'pointer',
                  }}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
              {hasExistingPw && (
                <p style={{ fontSize: '11px', color: '#b45309', margin: 0 }}>
                  Changing this won't re-encrypt files already exported with the old
                  password — keep the old one to open those.
                </p>
              )}
              {pwError && <p style={{ fontSize: '12px', color: '#dc2626', margin: 0 }}>{pwError}</p>}
            </div>
          )}
        </div>

        {/* App lock (native only) */}
        {lock && (
          <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
              App Lock
            </label>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
              A PIN locks the app on launch and encrypts your schedule on this
              device. There is no recovery if you forget it.
            </p>
            <button
              onClick={lock.onChangePin}
              style={{
                padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                background: 'white', cursor: 'pointer', fontSize: '13px',
              }}
            >
              Change PIN
            </button>
            {lock.faceIdAvailable && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={lock.faceIdEnabled}
                  onChange={(e) => lock.onToggleFaceId(e.target.checked)}
                />
                <span style={{ fontSize: '13px' }}>Unlock with Face ID</span>
              </label>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              background: 'white',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
