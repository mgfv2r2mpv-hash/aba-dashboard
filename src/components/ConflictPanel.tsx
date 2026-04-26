import React from 'react';
import { ScheduleConflict } from '../types';

interface ConflictPanelProps {
  conflicts: ScheduleConflict[];
}

export default function ConflictPanel({ conflicts }: ConflictPanelProps) {
  const errorCount = conflicts.filter(c => c.severity === 'error').length;
  const warningCount = conflicts.filter(c => c.severity === 'warning').length;

  const getIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return '#dc2626';
      case 'warning':
        return '#f59e0b';
      default:
        return '#3b82f6';
    }
  };

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
      <h3 style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        Issues Found
        {errorCount > 0 && <span style={{ color: '#dc2626', fontWeight: 'bold' }}>({errorCount} errors)</span>}
        {warningCount > 0 && <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>({warningCount} warnings)</span>}
      </h3>
      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {conflicts.map((conflict, idx) => (
          <div
            key={idx}
            style={{
              padding: '12px',
              marginBottom: '8px',
              backgroundColor: conflict.severity === 'error' ? '#fee2e2' : '#fef3c7',
              border: `1px solid ${getSeverityColor(conflict.severity)}`,
              borderRadius: '6px',
              fontSize: '12px',
            }}
          >
            <div style={{ marginBottom: '4px', fontWeight: 'bold', display: 'flex', gap: '4px' }}>
              <span>{getIcon(conflict.severity)}</span>
              <span>{conflict.type}</span>
            </div>
            <p style={{ color: '#374151' }}>{conflict.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
