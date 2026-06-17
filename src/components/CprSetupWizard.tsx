import React, { useState } from 'react';
import type { CodeSet, ObservationCode, EventCategory } from '../cpr/types';
import { DEFAULT_CODE_SETS, DEFAULT_LAG_WINDOW_MS, DEFAULT_LAG_COUNT } from '../cpr/defaults';

interface Props {
  onStart: (config: {
    clientLabel: string;
    observerName: string;
    date: string;
    codeSet: CodeSet;
    lagEnabled: boolean;
    lagWindowMs: number;
    lagCount: number;
    targetBehaviorId: string;
    notes: string;
  }) => void;
  onCancel: () => void;
}

const TODAY = new Date().toISOString().slice(0, 10);

const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid #d1d5db', fontSize: 15, color: '#111827',
  background: '#fff', outline: 'none', boxSizing: 'border-box',
};
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' };
const SECTION: React.CSSProperties = { marginBottom: 20 };
const HINT: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.4 };

const CATEGORY_COLORS: Record<EventCategory, { bg: string; text: string; label: string }> = {
  antecedent: { bg: '#fef3c7', text: '#92400e', label: 'Antecedent' },
  behavior:   { bg: '#fee2e2', text: '#991b1b', label: 'Behavior' },
  consequence:{ bg: '#d1fae5', text: '#065f46', label: 'Consequence' },
};

function CodeChip({ code }: { code: ObservationCode }) {
  const cat = CATEGORY_COLORS[code.category];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 12,
      backgroundColor: code.color + '22', border: `1px solid ${code.color}66`,
      fontSize: 12, color: '#374151', marginRight: 4, marginBottom: 4,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        backgroundColor: code.color, flexShrink: 0,
      }} />
      <strong>{code.abbr}</strong> · {code.label}
      <span style={{
        fontSize: 10, backgroundColor: cat.bg, color: cat.text,
        borderRadius: 4, padding: '1px 4px',
      }}>{cat.label[0]}</span>
    </span>
  );
}

export default function CprSetupWizard({ onStart, onCancel }: Props) {
  const [step, setStep] = useState(1);
  const [clientLabel, setClientLabel] = useState('');
  const [observerName, setObserverName] = useState('');
  const [date, setDate] = useState(TODAY);
  const [selectedPreset, setSelectedPreset] = useState<string>(DEFAULT_CODE_SETS[0].id);
  const [codeSet, setCodeSet] = useState<CodeSet>(DEFAULT_CODE_SETS[0]);
  const [editCodes, setEditCodes] = useState(false);
  const [lagEnabled, setLagEnabled] = useState(false);
  const [lagWindowSec, setLagWindowSec] = useState(DEFAULT_LAG_WINDOW_MS / 1000);
  const [lagCount, setLagCount] = useState(DEFAULT_LAG_COUNT);
  const [targetBehaviorId, setTargetBehaviorId] = useState(
    DEFAULT_CODE_SETS[0].codes.find(c => c.category === 'behavior')?.id ?? ''
  );
  const [notes, setNotes] = useState('');

  const behaviorCodes = codeSet.codes.filter(c => c.category === 'behavior');

  function selectPreset(id: string) {
    const preset = DEFAULT_CODE_SETS.find(s => s.id === id) ?? DEFAULT_CODE_SETS[0];
    setSelectedPreset(id);
    setCodeSet({ ...preset, codes: preset.codes.map(c => ({ ...c })) });
    const firstB = preset.codes.find(c => c.category === 'behavior');
    if (firstB) setTargetBehaviorId(firstB.id);
    setEditCodes(false);
  }

  function updateCodeLabel(id: string, value: string) {
    setCodeSet(cs => ({ ...cs, codes: cs.codes.map(c => c.id === id ? { ...c, label: value } : c) }));
  }

  function canProceedStep1() { return clientLabel.trim().length > 0 && observerName.trim().length > 0; }
  function canProceedStep2() { return codeSet.codes.some(c => c.category === 'behavior'); }
  function canProceedStep3() { return targetBehaviorId.length > 0; }

  function handleStart() {
    onStart({
      clientLabel: clientLabel.trim(),
      observerName: observerName.trim(),
      date,
      codeSet,
      lagEnabled,
      lagWindowMs: lagWindowSec * 1000,
      lagCount,
      targetBehaviorId,
      notes,
    });
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
        margin: 16, padding: 28, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[1, 2, 3].map(n => (
            <div key={n} style={{
              flex: 1, height: 4, borderRadius: 2,
              backgroundColor: step >= n ? '#6366f1' : '#e5e7eb',
              transition: 'background-color 0.2s',
            }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              Session Information
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.4 }}>
              Enter the basic details for this observation session. Use initials or a case ID to protect client privacy.
            </p>
            <div style={SECTION}>
              <label style={LABEL}>Client identifier</label>
              <input
                style={INPUT} value={clientLabel} autoFocus
                onChange={e => setClientLabel(e.target.value)}
                placeholder="e.g. J.S. or Case-042"
              />
              <p style={HINT}>Initials or case ID — this appears on the printed report.</p>
            </div>
            <div style={SECTION}>
              <label style={LABEL}>Observer name</label>
              <input
                style={INPUT} value={observerName}
                onChange={e => setObserverName(e.target.value)}
                placeholder="Your name or credentials"
              />
            </div>
            <div style={SECTION}>
              <label style={LABEL}>Observation date</label>
              <input style={INPUT} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              Observation Codes
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.4 }}>
              Choose a standard code set or start with Custom and edit the codes below.
            </p>
            <div style={SECTION}>
              <label style={LABEL}>Code set</label>
              {DEFAULT_CODE_SETS.map(preset => (
                <label key={preset.id} style={{
                  display: 'flex', gap: 10, padding: '10px 12px',
                  border: `2px solid ${selectedPreset === preset.id ? '#6366f1' : '#e5e7eb'}`,
                  borderRadius: 8, marginBottom: 8, cursor: 'pointer',
                  background: selectedPreset === preset.id ? '#eef2ff' : '#fff',
                }}>
                  <input
                    type="radio" name="preset" value={preset.id}
                    checked={selectedPreset === preset.id}
                    onChange={() => selectPreset(preset.id)}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{preset.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{preset.description}</div>
                    {preset.citation && (
                      <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>{preset.citation}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            {/* Code preview */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
                Codes in this set
              </div>
              <div>
                {codeSet.codes.map(code => <CodeChip key={code.id} code={code} />)}
              </div>
            </div>

            <button
              onClick={() => setEditCodes(e => !e)}
              style={{
                fontSize: 13, color: '#6366f1', background: 'none', border: 'none',
                cursor: 'pointer', padding: '4px 0', textDecoration: 'underline',
              }}
            >
              {editCodes ? 'Hide code editor' : 'Edit code labels'}
            </button>

            {editCodes && (
              <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 8, padding: 12 }}>
                <p style={{ ...HINT, marginBottom: 8 }}>
                  Edit the label for any code (abbreviations and colors are fixed per code set).
                </p>
                {(['antecedent', 'behavior', 'consequence'] as EventCategory[]).map(cat => {
                  const codes = codeSet.codes.filter(c => c.category === cat);
                  if (codes.length === 0) return null;
                  return (
                    <div key={cat} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: CATEGORY_COLORS[cat].text, marginBottom: 6 }}>
                        {CATEGORY_COLORS[cat].label}s
                      </div>
                      {codes.map(code => (
                        <div key={code.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{
                            width: 36, textAlign: 'center', fontSize: 11, fontWeight: 700,
                            background: code.color + '33', color: '#374151',
                            borderRadius: 4, padding: '3px 0', flexShrink: 0,
                          }}>{code.abbr}</div>
                          <input
                            style={{ ...INPUT, flex: 1 }}
                            value={code.label}
                            onChange={e => updateCodeLabel(code.id, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              Analysis Settings
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.4 }}>
              Configure the observation window and whether to run lag sequential analysis.
            </p>

            <div style={SECTION}>
              <label style={LABEL}>Target / criterion behavior</label>
              <select
                style={INPUT}
                value={targetBehaviorId}
                onChange={e => setTargetBehaviorId(e.target.value)}
              >
                {behaviorCodes.map(b => (
                  <option key={b.id} value={b.id}>{b.abbr} — {b.label}</option>
                ))}
              </select>
              <p style={HINT}>This is the behavior whose antecedents and consequences will be analyzed.</p>
            </div>

            <div style={SECTION}>
              <label style={LABEL}>Observation window size</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ ...INPUT, width: 80 }}
                  type="number" min={1} max={60}
                  value={lagWindowSec}
                  onChange={e => setLagWindowSec(Math.max(1, Number(e.target.value)))}
                />
                <span style={{ fontSize: 14, color: '#374151' }}>seconds</span>
              </div>
              <p style={HINT}>
                Time window used for antecedent and consequence analysis.
                Vollmer et al. (1993) recommend 10 seconds; this is the standard in the literature.
              </p>
            </div>

            <div style={{ ...SECTION, background: '#f9fafb', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Lag Sequential Analysis</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    Bakeman &amp; Gottman (1997) — tracks event probability across multiple consecutive windows
                  </div>
                </div>
                <button
                  onClick={() => setLagEnabled(v => !v)}
                  style={{
                    width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
                    background: lagEnabled ? '#6366f1' : '#d1d5db',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}
                  aria-pressed={lagEnabled}
                  aria-label="Toggle lag sequential analysis"
                >
                  <div style={{
                    position: 'absolute', top: 4, left: lagEnabled ? 22 : 4,
                    width: 20, height: 20, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </button>
              </div>
              {lagEnabled && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ ...LABEL, marginBottom: 6 }}>Number of lag intervals</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[3, 4, 5].map(n => (
                      <button
                        key={n}
                        onClick={() => setLagCount(n)}
                        style={{
                          padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                          fontWeight: 600, border: `2px solid ${lagCount === n ? '#6366f1' : '#d1d5db'}`,
                          background: lagCount === n ? '#eef2ff' : '#fff',
                          color: lagCount === n ? '#4f46e5' : '#374151',
                        }}
                      >{n}</button>
                    ))}
                  </div>
                  <p style={{ ...HINT, marginTop: 6 }}>
                    Each lag is one observation window. Lags 1–{lagCount} = {lagWindowSec}–{lagCount * lagWindowSec} seconds post-behavior.
                  </p>
                </div>
              )}
            </div>

            <div style={SECTION}>
              <label style={LABEL}>Session notes (optional)</label>
              <textarea
                style={{ ...INPUT, minHeight: 72, resize: 'vertical' }}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Setting, antecedent conditions, observer notes..."
              />
            </div>
          </>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            onClick={step === 1 ? onCancel : () => setStep(s => s - 1)}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 8, border: '1px solid #d1d5db',
              background: '#fff', color: '#374151', fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={step === 1 ? !canProceedStep1() : !canProceedStep2()}
              style={{
                flex: 2, padding: '11px 0', borderRadius: 8, border: 'none',
                background: (step === 1 ? canProceedStep1() : canProceedStep2()) ? '#6366f1' : '#d1d5db',
                color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
              }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!canProceedStep3()}
              style={{
                flex: 2, padding: '11px 0', borderRadius: 8, border: 'none',
                background: canProceedStep3() ? '#10b981' : '#d1d5db',
                color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
              }}
            >
              Start Recording
            </button>
          )}
        </div>
        <p style={{ ...HINT, textAlign: 'center', marginTop: 12 }}>Step {step} of 3</p>
      </div>
    </div>
  );
}
