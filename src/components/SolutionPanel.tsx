import React, { useState } from 'react';
import { ScheduleSolution } from '../types';

interface SolutionPanelProps {
  solutions: ScheduleSolution[];
  onApply: (solution: ScheduleSolution) => void;
}

export default function SolutionPanel({ solutions, onApply }: SolutionPanelProps) {
  const [expanded, setExpanded] = useState<number>(0);

  return (
    <div style={{ padding: '16px', overflow: 'auto', flex: 1 }}>
      <h3 style={{ marginBottom: '12px' }}>💡 Suggested Solutions</h3>
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
            <span>Solution {idx + 1}: {solution.affectedWeeks === 1 ? '1 week' : `${solution.affectedWeeks} weeks`}</span>
            <span>{expanded === idx ? '▼' : '▶'}</span>
          </button>

          {expanded === idx && (
            <div style={{ padding: '12px', borderTop: '1px solid #10b981' }}>
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                  <strong>Reasoning:</strong>
                </p>
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

              <button
                onClick={() => onApply(solution)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '13px',
                }}
              >
                Apply This Solution
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
