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

interface SettingsProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
  onClearKey: () => void;
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

export default function Settings({ settings, onSave, onClose, onClearKey }: SettingsProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState<ClaudeModel>(settings.model);
  const [showKey, setShowKey] = useState(false);
  const [schedulePassword, setSchedulePassword] = useState(settings.schedulePassword || '');
  const [showSchedulePw, setShowSchedulePw] = useState(false);

  const handleSave = () => {
    onSave({ apiKey: apiKey.trim(), model, schedulePassword: schedulePassword.trim() || undefined });
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={showSchedulePw ? 'text' : 'password'}
              placeholder="Leave blank for no encryption"
              value={schedulePassword}
              onChange={(e) => setSchedulePassword(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
              }}
            />
            <button
              onClick={() => setShowSchedulePw(!showSchedulePw)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              {showSchedulePw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

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
