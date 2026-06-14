import React from 'react';
import { ScheduleConflict, Appointment, PartyAvailability } from '../types';

function fmt12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = mStr ?? '00';
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

function partyMark(status: PartyAvailability['status']): { icon: string; color: string; label: string } {
  switch (status) {
    case 'ok': return { icon: '✓', color: '#15803d', label: 'available' };
    case 'outside': return { icon: '✗', color: '#dc2626', label: 'outside window' };
    case 'none': return { icon: '–', color: '#6b7280', label: 'no availability set' };
    case 'blackout': return { icon: '⛔', color: '#b91c1c', label: 'away (blackout)' };
  }
}

function windowsText(p: PartyAvailability): string {
  if (p.status === 'blackout') return p.blackoutReason ? `Away — ${p.blackoutReason}` : 'Away (blackout)';
  if (!p.windows || p.windows.length === 0) return 'No windows this day';
  return p.windows.map(w => `${fmt12(w.start)} – ${fmt12(w.end)}`).join(', ');
}

export function conflictKey(c: ScheduleConflict): string {
  const appts = (c.affectedAppointments || []).join(',');
  const date = c.availabilityDetail?.date || '';
  return `${c.type}|${c.severity}|${appts}|${date}|${c.message}`;
}

// Human-readable title derived from conflict type + message content.
export function conflictTitle(c: ScheduleConflict): string {
  const msg = c.message.toLowerCase();
  switch (c.type) {
    case 'availability-conflict':
      return 'Availability Conflict';
    case 'training-violation':
      if (msg.includes('below') || msg.includes('minimum') || msg.includes('too low') || msg.includes('under'))
        return 'PT Below Minimum';
      if (msg.includes('above') || msg.includes('maximum') || msg.includes('exceeds') || msg.includes('over'))
        return 'PT Over Maximum';
      return 'Parent Training Issue';
    case 'supervision-violation':
      if (msg.includes('contact') || msg.includes('count'))
        return 'Supervision Contact Shortfall';
      if (msg.includes('percent') || msg.includes('%'))
        return 'Supervision % Gap';
      return 'Supervision Gap';
    case 'scheduling-impossible':
      if (msg.includes('no bt') || msg.includes('not assigned') || msg.includes('unstaff'))
        return 'No BT Assigned';
      if (msg.includes('utilization') || msg.includes('below') && msg.includes('%'))
        return 'Below Targeted Utilization';
      if (msg.includes('authorization') && (msg.includes('over') || msg.includes('exceed')))
        return 'Over Authorization';
      if (msg.includes('billable') && msg.includes('minimum'))
        return 'Below Billable Minimum';
      if (msg.includes('reassessment'))
        return 'Reassessment Pacing';
      if (msg.includes('double') || msg.includes('concurrent'))
        return 'Concurrent Booking';
      return 'Scheduling Issue';
    default:
      return c.type.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
}

// Per-type ordering weight for sorting within a severity bucket.
function typeWeight(c: ScheduleConflict): number {
  switch (c.type) {
    case 'availability-conflict': return 0;
    case 'supervision-violation': return 1;
    case 'training-violation': return 2;
    case 'scheduling-impossible': {
      const msg = c.message.toLowerCase();
      if (msg.includes('no bt') || msg.includes('unstaff')) return 4;
      return 3;
    }
    default: return 5;
  }
}

function severityWeight(c: ScheduleConflict): number {
  switch (c.severity) {
    case 'error': return 0;
    case 'warning': return 1;
    default: return 2;
  }
}

function sortConflicts(cs: ScheduleConflict[]): ScheduleConflict[] {
  return [...cs].sort((a, b) => {
    const sw = severityWeight(a) - severityWeight(b);
    if (sw !== 0) return sw;
    const tw = typeWeight(a) - typeWeight(b);
    if (tw !== 0) return tw;
    // More affected appointments = larger problem = first
    return (b.affectedAppointments?.length ?? 0) - (a.affectedAppointments?.length ?? 0);
  });
}

// Background color for each conflict type / sub-type.
function cardBackground(c: ScheduleConflict): string {
  if (c.type === 'training-violation') {
    const msg = c.message.toLowerCase();
    if (msg.includes('below') || msg.includes('minimum') || msg.includes('too low') || msg.includes('under'))
      return '#fff7ed'; // light orange for PT below minimum
    return '#fee2e2';   // light red for PT over maximum
  }
  if (c.severity === 'error') return '#fee2e2';
  if (c.severity === 'warning') return '#fef3c7';
  // Info — check sub-type
  const msg = c.message.toLowerCase();
  if (msg.includes('no bt') || msg.includes('unstaff')) return '#fefce8'; // light yellow
  return '#eff6ff'; // default info: light blue
}

interface ConflictPanelProps {
  conflicts: ScheduleConflict[];
  appointments?: Appointment[];
  onSelectAppointment?: (a: Appointment) => void;
  fill?: boolean;
  mutedKeys?: string[];
  onMute?: (key: string) => void;
  onUnmute?: (key: string) => void;
  onConfirmDismiss?: (key: string) => void;
}

export default function ConflictPanel({ conflicts, appointments = [], onSelectAppointment, fill, mutedKeys, onMute, onUnmute, onConfirmDismiss }: ConflictPanelProps) {
  const [showMuted, setShowMuted] = React.useState(false);
  const muted = new Set(mutedKeys || []);
  const active = sortConflicts(conflicts.filter(c => !muted.has(conflictKey(c))));
  const mutedConflicts = conflicts.filter(c => muted.has(conflictKey(c)));
  const errorCount = active.filter(c => c.severity === 'error').length;
  const warningCount = active.filter(c => c.severity === 'warning').length;

  const getIcon = (severity: string) => {
    switch (severity) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error': return '#dc2626';
      case 'warning': return '#f59e0b';
      default: return '#3b82f6';
    }
  };

  const renderCard = (conflict: ScheduleConflict, idx: number, isMuted: boolean) => {
    const key = conflictKey(conflict);
    const title = conflictTitle(conflict);
    const bg = cardBackground(conflict);
    const affectedAppts = (conflict.affectedAppointments || [])
      .map(id => appointments.find(a => a.id === id))
      .filter((a): a is Appointment => Boolean(a));
    const canDismiss = !!onConfirmDismiss && conflict.severity !== 'error';
    return (
      <div
        key={idx}
        style={{
          padding: '12px',
          marginBottom: '8px',
          backgroundColor: bg,
          border: `1px solid ${getSeverityColor(conflict.severity)}`,
          borderRadius: '6px',
          fontSize: '12px',
          opacity: isMuted ? 0.7 : 1,
        }}
      >
        <div style={{ marginBottom: '4px', fontWeight: 'bold', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span>{getIcon(conflict.severity)}</span>
          <span style={{ color: '#1f2937' }}>{title}</span>
        </div>
        <p style={{ color: '#374151', margin: '4px 0' }}>{conflict.message}</p>
        {conflict.availabilityDetail && (() => {
          const d = conflict.availabilityDetail;
          return (
            <div style={{
              marginTop: 8, padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.7)',
              border: '1px solid #e5e7eb', borderRadius: 5,
            }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                {d.day} · {fmt12(d.start)} – {fmt12(d.end)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {d.parties.map((p, i) => {
                  const mark = partyMark(p.status);
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ color: mark.color, fontWeight: 700, width: 14, flexShrink: 0, textAlign: 'center' }}>{mark.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#374151' }}>
                          <strong>{p.name}</strong>
                          <span style={{ color: '#9ca3af' }}> · {p.role}</span>
                        </div>
                        <div style={{ color: mark.color }}>{windowsText(p)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
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
        {(onMute || onUnmute || canDismiss) && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {isMuted
              ? (onUnmute && <button onClick={() => onUnmute(key)} style={actionBtn}>Unmute</button>)
              : (
                <>
                  {canDismiss && <button onClick={() => onConfirmDismiss!(key)} style={confirmBtn}>✓ Confirm &amp; Dismiss</button>}
                  {onMute && <button onClick={() => onMute(key)} style={actionBtn}>🔇 Mute</button>}
                </>
              )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      padding: '16px', boxSizing: 'border-box',
      ...(fill ? { minHeight: '100%' } : { borderBottom: '1px solid #e5e7eb' }),
    }}>
      <h3 style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        Issues Found
        {errorCount > 0 && <span style={{ color: '#dc2626', fontWeight: 'bold' }}>({errorCount} error{errorCount !== 1 ? 's' : ''})</span>}
        {warningCount > 0 && <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>({warningCount} warning{warningCount !== 1 ? 's' : ''})</span>}
      </h3>
      <div>
        {active.length === 0 && mutedConflicts.length > 0 && (
          <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 8px' }}>No active issues — all muted below.</p>
        )}
        {active.map((conflict, idx) => renderCard(conflict, idx, false))}
      </div>

      {mutedConflicts.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px dashed #d1d5db', paddingTop: 8 }}>
          <button
            onClick={() => setShowMuted(s => !s)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 12, fontWeight: 700, color: '#6b7280',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span>🔇 Muted ({mutedConflicts.length})</span>
            <span>{showMuted ? '▾' : '▸'}</span>
          </button>
          {showMuted && (
            <div style={{ marginTop: 8 }}>
              {mutedConflicts.map((conflict, idx) => renderCard(conflict, idx, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  padding: '4px 10px', background: 'white', color: '#374151',
  border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};

const confirmBtn: React.CSSProperties = {
  padding: '4px 10px', background: '#dcfce7', color: '#15803d',
  border: '1px solid #86efac', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
