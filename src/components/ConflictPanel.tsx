import React from 'react';
import { ScheduleConflict, Appointment, PartyAvailability } from '../types';

// "16:30" → "4:30 PM". Availability windows and slot times are stored as 24h
// HH:MM; render them 12h to match the rest of the app's locale formatting.
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

// A stable per-instance key for a conflict. Includes the message and (for
// availability conflicts) the date, so a mute/dismiss applies ONLY to that exact
// instance — the same kind of conflict in a future month has a different date /
// message and is therefore NOT muted automatically.
export function conflictKey(c: ScheduleConflict): string {
  const appts = (c.affectedAppointments || []).join(',');
  const date = c.availabilityDetail?.date || '';
  return `${c.type}|${c.severity}|${appts}|${date}|${c.message}`;
}

interface ConflictPanelProps {
  conflicts: ScheduleConflict[];
  appointments?: Appointment[];
  onSelectAppointment?: (a: Appointment) => void;
  // Docked-pane mode: stretch to the full height of the scroll region so the
  // issues list fills to the bottom of the frozen pane (and scrolls when long)
  // instead of ending partway and leaving dead space. Narrow layout omits this.
  fill?: boolean;
  // Per-instance mute/dismiss. Muted conflicts drop into a minimized bin at the
  // bottom; "confirm & dismiss" removes a (non-error) conflict outright. Keys
  // come from conflictKey(); the parent owns the sets so both ConflictPanel
  // instances (schedule pane + compliance tab) stay consistent.
  mutedKeys?: string[];
  onMute?: (key: string) => void;
  onUnmute?: (key: string) => void;
  onConfirmDismiss?: (key: string) => void;
}

export default function ConflictPanel({ conflicts, appointments = [], onSelectAppointment, fill, mutedKeys, onMute, onUnmute, onConfirmDismiss }: ConflictPanelProps) {
  const [showMuted, setShowMuted] = React.useState(false);
  const muted = new Set(mutedKeys || []);
  const active = conflicts.filter(c => !muted.has(conflictKey(c)));
  const mutedConflicts = conflicts.filter(c => muted.has(conflictKey(c)));
  const errorCount = active.filter(c => c.severity === 'error').length;
  const warningCount = active.filter(c => c.severity === 'warning').length;

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

  const renderCard = (conflict: ScheduleConflict, idx: number, isMuted: boolean) => {
    const key = conflictKey(conflict);
    const affectedAppts = (conflict.affectedAppointments || [])
      .map(id => appointments.find(a => a.id === id))
      .filter((a): a is Appointment => Boolean(a));
    // "Confirm & dismiss" is for warnings/info (e.g. an out-of-window session
    // the BCBA has decided is fine) — errors must be resolved, not dismissed.
    const canDismiss = !!onConfirmDismiss && conflict.severity !== 'error';
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
          opacity: isMuted ? 0.7 : 1,
        }}
      >
        <div style={{ marginBottom: '4px', fontWeight: 'bold', display: 'flex', gap: '4px' }}>
          <span>{getIcon(conflict.severity)}</span>
          <span>{conflict.type}</span>
        </div>
        <p style={{ color: '#374151' }}>{conflict.message}</p>
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
                  {canDismiss && <button onClick={() => onConfirmDismiss!(key)} style={confirmBtn}>✓ Confirm &amp; dismiss</button>}
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
      // Fill the pane to the bottom when docked; otherwise a divider under the
      // (page-flow) list in the narrow layout.
      ...(fill ? { minHeight: '100%' } : { borderBottom: '1px solid #e5e7eb' }),
    }}>
      <h3 style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        Issues Found
        {errorCount > 0 && <span style={{ color: '#dc2626', fontWeight: 'bold' }}>({errorCount} errors)</span>}
        {warningCount > 0 && <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>({warningCount} warnings)</span>}
      </h3>
      {/* No height cap: in the docked frozen pane this list fills the space left
          by the hours summary and the slide-up appointment, and overflow scrolls
          in the pane's own scroll region; in the narrow single-column layout the
          page scrolls. The old 300px cap kept it stuck "very short" either way. */}
      <div>
        {active.length === 0 && mutedConflicts.length > 0 && (
          <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 8px' }}>No active issues — all muted below.</p>
        )}
        {active.map((conflict, idx) => renderCard(conflict, idx, false))}
      </div>

      {/* Muted bin — minimized by default, pinned to the bottom of the list. */}
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
