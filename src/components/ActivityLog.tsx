// Activity — the append-only history of committed schedule changes, newest
// first. Each undoable entry offers "Undo", which stages the entry's INVERSE
// into the normal draft tray with a blast-radius preview (UndoPreview) before
// anything commits. View-only entries (imports, wizard, bulk admin) are
// receipts, not reversals. A modal (not a view-union member) so it opens the
// same way from every screen.

import { ScheduleData, ActionLogEntry, ActionSource } from '../types';
import { useRoster } from '../rosterContext';

const SOURCE_ICON: Record<ActionSource, string> = {
  build: '⚙︎', wish: '✨', tidy: '🩺', manual: '✋', chat: '💬', undo: '↩︎', import: '⇪', admin: '🔧',
};

interface ActivityLogProps {
  data: ScheduleData;
  onUndo: (entry: ActionLogEntry) => void;
  onClose: () => void;
}

export default function ActivityLog({ data, onUndo, onClose }: ActivityLogProps) {
  const { clientName, techName } = useRoster();
  const entries = [...(data.actionLog ?? [])].reverse(); // newest first

  // First few affected entity names for a row ("JO, TT +3 more").
  const affectedNames = (e: ActionLogEntry): string => {
    const names = new Set<string>();
    for (const op of e.ops) {
      const appt = op.appt ?? (op.targetId ? e.before[op.targetId] ?? undefined : undefined);
      if (appt?.client) names.add(clientName(appt.client));
      if (appt?.technician) names.add(techName(appt.technician));
      if (names.size >= 6) break;
    }
    for (const h of e.hintChanges ?? []) names.add(clientName(h.clientId));
    const list = [...names].filter(n => n && n !== '—');
    if (list.length === 0) return '';
    return list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '');
  };

  const when = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))', boxSizing: 'border-box',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '100%',
          overflow: 'auto', padding: 16, boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Activity</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
          Every committed change, newest first. Undo stages the reversal as a reviewable draft — you see the
          exact blast radius (what it touches and how the numbers move) before anything changes.
        </p>

        {entries.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>No committed changes recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map(e => {
              const names = affectedNames(e);
              return (
                <div
                  key={e.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    border: '1px solid #f3f4f6', borderRadius: 8, padding: '8px 10px',
                    background: e.source === 'undo' ? '#f8fafc' : 'white',
                  }}
                >
                  <span title={e.source} style={{ fontSize: 15, flexShrink: 0 }}>{SOURCE_ICON[e.source]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>
                      {when(e.at)}
                      {e.ops.length > 0 && ` · ${e.ops.length} change${e.ops.length === 1 ? '' : 's'}`}
                      {e.counts && ` · ${e.counts.appts} appts, ${e.counts.clients} clients, ${e.counts.techs} techs`}
                      {names && ` · ${names}`}
                    </div>
                  </div>
                  {e.undoable ? (
                    <button
                      type="button"
                      onClick={() => onUndo(e)}
                      style={{
                        flexShrink: 0, fontSize: 12, fontWeight: 700, padding: '5px 10px',
                        borderRadius: 6, border: '1px solid #d1d5db', background: 'white',
                        color: '#374151', cursor: 'pointer',
                      }}
                    >
                      ↩︎ Undo
                    </button>
                  ) : (
                    <span style={{ flexShrink: 0, fontSize: 11, color: '#9ca3af' }}>view-only</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
