import React, { useState } from 'react';
import { Appointment } from '../types';

// End-of-day sweep: every past-dated session still marked "scheduled" gets a
// quick Complete / Cancel / Skip decision so actuals stay current without
// hunting through the calendar. Skip just hides the row for this sitting.
export default function DayReview({ appointments, onComplete, onRequestCancel, onClose }: {
  appointments: Appointment[];        // past-due, unfinalized (pre-sorted)
  onComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onClose: () => void;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const visible = appointments.filter(a => !skipped.has(a.id));

  const skip = (id: string) => setSkipped(prev => new Set(prev).add(id));

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    }}>
      <div style={{
        backgroundColor: 'white', borderRadius: 8, padding: 20,
        width: '100%', maxWidth: 560, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Day review</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          Sessions up to now still marked scheduled. Complete or cancel each so this month's actuals are real;
          skip anything you're not sure about yet.
        </p>

        {visible.length === 0 ? (
          <p style={{ color: '#15803d', fontWeight: 600, textAlign: 'center', padding: 16 }}>
            ✓ All caught up.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visible.map(a => (
              <div key={a.id} style={{
                border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {new Date(a.startTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {' → '}
                    {new Date(a.endTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {a.technician ? ` · ${a.technician}` : ''}{a.client ? ` · ${a.client}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => onComplete(a)} style={{
                    padding: '6px 10px', backgroundColor: '#dcfce7', color: '#15803d',
                    border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}>✓ Complete</button>
                  <button onClick={() => onRequestCancel(a)} style={{
                    padding: '6px 10px', backgroundColor: '#fee2e2', color: '#b91c1c',
                    border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}>✕ Cancel</button>
                  <button onClick={() => skip(a.id)} style={{
                    padding: '6px 10px', backgroundColor: 'white', color: '#6b7280',
                    border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                  }}>Skip</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6,
            background: 'white', cursor: 'pointer',
          }}>Done</button>
        </div>
      </div>
    </div>
  );
}
