import React from 'react';
import { ScheduleData } from '../types';
import { diffSchedule, isEmptyDiff, NameDelta } from '../scheduleDiff';

interface Props {
  current: ScheduleData;
  next: ScheduleData;
  fileName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Modal shown after a user picks a different Excel file from Admin → Settings.
// It does NOT replace the loaded schedule until the user confirms — so an
// accidental pick (or a file that's missing half the roster) can be backed out
// of without losing the current data.
export default function ImportPreview({ current, next, fileName, onConfirm, onCancel }: Props) {
  const diff = diffSchedule(current, next);
  const noChange = isEmptyDiff(diff);

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Replace current schedule?</h2>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
          {fileName ? <>From <strong>{fileName}</strong>. </> : null}
          This will overwrite the schedule you have loaded. Nothing changes until
          you choose <strong>Replace</strong>.
        </p>

        {noChange ? (
          <p style={{ fontSize: 13, color: '#6b7280', backgroundColor: '#f3f4f6', padding: 12, borderRadius: 6 }}>
            This file looks identical to what's already loaded — no changes detected.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <DeltaCard title="Clients" delta={diff.clients} />
            <DeltaCard title="Technicians" delta={diff.technicians} />
            <div style={card}>
              <div style={cardTitle}>Appointments</div>
              <div style={{ fontSize: 13, color: '#374151' }}>
                {diff.appointments.current} → <strong>{diff.appointments.next}</strong>
                {diff.appointments.delta !== 0 && (
                  <span style={{ marginLeft: 6, color: diff.appointments.delta > 0 ? '#15803d' : '#b91c1c' }}>
                    ({diff.appointments.delta > 0 ? '+' : ''}{diff.appointments.delta})
                  </span>
                )}
              </div>
            </div>
            {diff.settingsChanged && (
              <div style={card}>
                <div style={cardTitle}>Company settings</div>
                <div style={{ fontSize: 13, color: '#a16207' }}>Settings differ and will be replaced.</div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnSecondary}>Cancel</button>
          <button onClick={onConfirm} style={btnDanger}>Replace current data</button>
        </div>
      </div>
    </div>
  );
}

function DeltaCard({ title, delta }: { title: string; delta: NameDelta }) {
  const none = delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0;
  return (
    <div style={card}>
      <div style={cardTitle}>{title}</div>
      {none ? (
        <div style={{ fontSize: 13, color: '#6b7280' }}>No changes</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {delta.added.length > 0 && <Line color="#15803d" label="Added" names={delta.added} />}
          {delta.removed.length > 0 && <Line color="#b91c1c" label="Removed" names={delta.removed} />}
          {delta.changed.length > 0 && <Line color="#a16207" label="Changed" names={delta.changed} />}
        </div>
      )}
    </div>
  );
}

function Line({ color, label, names }: { color: string; label: string; names: string[] }) {
  return (
    <div>
      <span style={{ color, fontWeight: 600 }}>{label} ({names.length}):</span>{' '}
      <span style={{ color: '#374151' }}>{names.join(', ')}</span>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
};
const modal: React.CSSProperties = {
  backgroundColor: 'white', borderRadius: 12, padding: 20,
  width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
};
const card: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 10,
};
const cardTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6,
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 14px', backgroundColor: '#e5e7eb', color: '#374151',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const btnDanger: React.CSSProperties = {
  padding: '8px 14px', backgroundColor: '#b91c1c', color: 'white',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
