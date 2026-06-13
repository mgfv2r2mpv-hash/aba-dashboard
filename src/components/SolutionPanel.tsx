import React, { useState } from 'react';
import { ScheduleSolution } from '../types';

interface SolutionPanelProps {
  solutions: ScheduleSolution[];
  onAccept: (solution: ScheduleSolution) => void;
  // Load this option into the editable draft so the user can tweak before
  // accepting. Optional — omit to hide the Customize button.
  onCustomize?: (solution: ScheduleSolution) => void;
  // Reject the whole proposal set (clears the options, keeps the draft).
  onReject?: () => void;
  heading?: string;
}

export default function SolutionPanel({ solutions, onAccept, onCustomize, onReject, heading }: SolutionPanelProps) {
  const [expanded, setExpanded] = useState<number>(0);

  return (
    <div style={{ padding: '16px', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: 8 }}>
        <h3 style={{ margin: 0 }}>💡 {heading || 'AI options'}</h3>
        {onReject && (
          <button
            onClick={onReject}
            style={{
              padding: '4px 10px', fontSize: 12, background: 'white', color: '#6b7280',
              border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer',
            }}
          >Reject set</button>
        )}
      </div>
      {solutions.map((solution, idx) => (
        <div
          key={solution.id}
          style={{
            marginBottom: '12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #10b981',
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => setExpanded(expanded === idx ? -1 : idx)}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: idx === expanded ? '#d1fae5' : 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontWeight: '600',
            }}
          >
            <span>Option {idx + 1}: {solution.affectedWeeks === 1 ? '1 week' : `${solution.affectedWeeks} weeks`}</span>
            <span>{expanded === idx ? '▼' : '▶'}</span>
          </button>

          {expanded === idx && (
            <div style={{ padding: '12px', borderTop: '1px solid #10b981' }}>
              {solution.affectedWeeks > 1 && (
                <div style={{
                  marginBottom: '12px',
                  padding: '8px 10px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#92400e',
                }}>
                  ⚠️ Spans {solution.affectedWeeks} weeks
                  {solution.weekSpan && (
                    <> ({solution.weekSpan.startDate} to {solution.weekSpan.endDate})</>
                  )}.
                </div>
              )}
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontSize: '13px', lineHeight: '1.5', color: '#374151' }}>
                  {solution.reasoning}
                </p>
              </div>

              {solution.changes.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: '600' }}>
                    Changes:
                  </p>
                  {solution.changes.map((change, cidx) => (
                    <div key={cidx} style={{ fontSize: '12px', color: '#374151', marginBottom: '8px' }}>
                      <p>• <strong>{change.appointmentId}</strong></p>
                      <p style={{ marginLeft: '16px' }}>
                        {change.oldTime.start} → {change.newTime.start}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => onAccept(solution)}
                  style={{
                    flex: '1 1 auto', padding: '10px', backgroundColor: '#10b981', color: 'white',
                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '13px',
                  }}
                >Accept</button>
                {onCustomize && (
                  <button
                    onClick={() => onCustomize(solution)}
                    style={{
                      flex: '1 1 auto', padding: '10px', backgroundColor: 'white', color: '#374151',
                      border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '13px',
                    }}
                  >Customize</button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
