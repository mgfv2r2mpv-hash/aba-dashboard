import React from 'react';
import { ScheduleConflict, Appointment } from '../types';

interface ConflictPanelProps {
  conflicts: ScheduleConflict[];
  appointments?: Appointment[];
  onSelectAppointment?: (a: Appointment) => void;
}

export default function ConflictPanel({ conflicts, appointments = [], onSelectAppointment }: ConflictPanelProps) {
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
        {conflicts.map((conflict, idx) => {
          const affectedAppts = (conflict.affectedAppointments || [])
            .map(id => appointments.find(a => a.id === id))
            .filter((a): a is Appointment => Boolean(a));
          return (
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
              {affectedAppts.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {affectedAppts.map(a => (
                    <button
                      key={a.id}
                      onClick={() => onSelectAppointment?.(a)}
                      style={{
                        textAlign: 'left', background: 'transparent', border: 'none',
                        padding: 0, color: '#1d4ed8', cursor: 'pointer',
                        fontSize: 12, textDecoration: 'underline',
                      }}
                    >
                      → {a.title} ({new Date(a.startTime).toLocaleString()})
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
