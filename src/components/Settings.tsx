import React, { useState } from 'react';

export type ClaudeModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

export interface AISettings {
  apiKey: string;
  model: ClaudeModel;
}

interface SettingsProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
  onEmbedInExcel: (password: string) => Promise<void>;
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

export default function Settings({ settings, onSave, onClose, onEmbedInExcel, onClearKey }: SettingsProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState<ClaudeModel>(settings.model);
  const [showKey, setShowKey] = useState(false);
  const [embedPassword, setEmbedPassword] = useState('');
  const [embedConfirm, setEmbedConfirm] = useState('');
  const [embedStatus, setEmbedStatus] = useState<string | null>(null);

  const handleSave = () => {
    onSave({ apiKey: apiKey.trim(), model });
    onClose();
  };

  const handleEmbed = async () => {
    setEmbedStatus(null);
    if (embedPassword.length < 8) {
      setEmbedStatus('Password must be at least 8 characters');
      return;
    }
    if (embedPassword !== embedConfirm) {
      setEmbedStatus('Passwords do not match');
      return;
    }
    if (!apiKey.trim()) {
      setEmbedStatus('Enter an API key first');
      return;
    }

    try {
      await onEmbedInExcel(embedPassword);
      setEmbedStatus('Encrypted blob ready - it will be saved on next download');
      setEmbedPassword('');
      setEmbedConfirm('');
    } catch (err: any) {
      setEmbedStatus(`Error: ${err.message}`);
    }
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
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        width: '500px',
        maxHeight: '90vh',
        overflowY: 'auto',
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

        {/* Embed in Excel */}
        <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
            Embed Encrypted Key in Excel (optional)
          </label>
          <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
            On next download, your API key + model will be encrypted with this password and saved into the Excel file.
            On re-upload, you'll be prompted for this password to decrypt.
          </p>
          <input
            type="password"
            placeholder="Embed password (8+ chars)"
            value={embedPassword}
            onChange={(e) => setEmbedPassword(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              marginBottom: '8px',
            }}
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={embedConfirm}
            onChange={(e) => setEmbedConfirm(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              marginBottom: '8px',
            }}
          />
          <button
            onClick={handleEmbed}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Prepare Encrypted Embed
          </button>
          {embedStatus && (
            <p style={{
              marginTop: '8px',
              fontSize: '12px',
              color: embedStatus.startsWith('Error') ? '#dc2626' : '#10b981',
            }}>
              {embedStatus}
            </p>
          )}
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
