import React, { useState, useMemo } from 'react';
import { Appointment, ScheduleData } from '../types';
import {
  ClientCompliance, computeClientCompliance, pastIncompleteAppointments, monthPeriod,
} from '../compliance';

interface Props {
  data: ScheduleData;
  onMarkComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onSelectAppointment: (a: Appointment) => void;
}

export default function ComplianceDashboard({ data, onMarkComplete, onRequestCancel, onSelectAppointment }: Props) {
  const [periodRef, setPeriodRef] = useState(new Date());
  const period = useMemo(() => monthPeriod(periodRef), [periodRef]);
  const reports = useMemo(() => computeClientCompliance(data, period), [data, period]);
  const pastIncomplete = useMemo(() => pastIncompleteAppointments(data), [data]);
  const targetPct = data.settings.supervisionDirectHoursPercent || 5;

  const goPrev = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() - 1, 1));
  const goNext = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() + 1, 1));
  const goToday = () => setPeriodRef(new Date());

  return (
    <div style={{ flex: 1, padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Compliance — {period.label}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <NavBtn onClick={goPrev}>←</NavBtn>
          <NavBtn onClick={goToday}>Today</NavBtn>
          <NavBtn onClick={goNext}>→</NavBtn>
        </div>
      </div>

      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
        Supervision target: <strong>{targetPct}%</strong> of direct hours per client.
        Counted only when supervision time-overlaps a direct session for the same client.
      </p>

      {pastIncomplete.length > 0 && (
        <PastIncomplete
          items={pastIncomplete}
          onMarkComplete={onMarkComplete}
          onRequestCancel={onRequestCancel}
          onSelect={onSelectAppointment}
        />
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {reports.length === 0 && (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
            No clients yet. Add clients in Admin to start tracking compliance.
          </p>
        )}
        {reports.map(r => <ClientCard key={r.client.id} report={r} targetPct={targetPct} />)}
      </div>
    </div>
  );
}

// ---------- Past sessions to review ----------

function PastIncomplete({ items, onMarkComplete, onRequestCancel, onSelect }: {
  items: Appointment[];
  onMarkComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onSelect: (a: Appointment) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{
      backgroundColor: '#fef3c7', border: '1px solid #f59e0b',
      borderRadius: 8, padding: 12, marginBottom: 16,
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 700, color: '#92400e', padding: 0,
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          justifyContent: 'space-between',
        }}
      >
        <span>Past sessions to review ({items.length})</span>
        <span>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 11, color: '#92400e', margin: 0, marginBottom: 4 }}>
            These count toward Actual compliance as if they happened. Mark each
            so the actual roll matches reality.
          </p>
          {items.map(a => (
            <div key={a.id} style={{
              backgroundColor: 'white', borderRadius: 6, padding: 8,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <button
                onClick={() => onSelect(a)}
                style={{
                  background: 'none', border: 'none', padding: 0, textAlign: 'left',
                  fontSize: 13, fontWeight: 600, color: '#1d4ed8', cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >{a.title}</button>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                {new Date(a.startTime).toLocaleString()} → {new Date(a.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {a.client && <> · {a.client}</>}
                {a.technician && <> · {a.technician}</>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onMarkComplete(a)} style={completeBtn}>✓ Complete</button>
                <button onClick={() => onRequestCancel(a)} style={cancelBtn}>✕ Cancel</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Per-client card ----------

function ClientCard({ report, targetPct }: { report: ClientCompliance; targetPct: number }) {
  const { client, actual, projected } = report;
  const noDirect = actual.directHours === 0 && projected.directHours === 0;

  // Status: green if actual already meets, yellow if projected meets but actual
  // doesn't, red if even projected falls short. Inactive clients (no direct
  // hours) get a neutral gray.
  let status: 'green' | 'yellow' | 'red' | 'gray';
  if (noDirect) status = 'gray';
  else if (actual.pct >= targetPct) status = 'green';
  else if (projected.pct >= targetPct) status = 'yellow';
  else status = 'red';

  const accentColor =
    status === 'green' ? '#15803d' :
    status === 'yellow' ? '#a16207' :
    status === 'red' ? '#b91c1c' :
    '#6b7280';

  return (
    <div style={{
      backgroundColor: 'white',
      border: `2px solid ${accentColor}`,
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{client.name}</h3>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          color: 'white', backgroundColor: accentColor,
          padding: '2px 8px', borderRadius: 10,
        }}>{statusLabel(status)}</span>
      </div>

      {noDirect ? (
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          No direct sessions in {monthLabel(report)}. Nothing to supervise.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Metric title="Actual" m={actual} targetPct={targetPct} accent={accentColor} />
          <Metric title="Projected" m={projected} targetPct={targetPct} accent={accentColor} />
        </div>
      )}
    </div>
  );
}

function Metric({ title, m, targetPct, accent }: {
  title: string;
  m: { directHours: number; supervisionHours: number; requiredHours: number; pct: number; hoursToGo: number };
  targetPct: number;
  accent: string;
}) {
  const fillPct = Math.min(100, m.pct);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>
        {m.pct.toFixed(1)}%
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>
          of {targetPct}% target
        </span>
      </div>
      <div style={{
        marginTop: 6, height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${fillPct}%`,
          backgroundColor: accent, transition: 'width 200ms',
        }} />
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
        Direct: <strong>{m.directHours.toFixed(1)}h</strong> ·
        Sup: <strong>{m.supervisionHours.toFixed(1)}h</strong>
        <br />
        Required: <strong>{m.requiredHours.toFixed(1)}h</strong>
        {m.hoursToGo > 0 && (
          <> · To go: <strong style={{ color: accent }}>{m.hoursToGo.toFixed(1)}h</strong></>
        )}
        {m.hoursToGo === 0 && m.directHours > 0 && (
          <> · ✓ at target</>
        )}
      </div>
    </div>
  );
}

function monthLabel(r: ClientCompliance): string {
  // Just used in a display string; the metric carries enough context.
  return 'this period';
}

function statusLabel(s: 'green' | 'yellow' | 'red' | 'gray'): string {
  switch (s) {
    case 'green': return 'on target';
    case 'yellow': return 'projected ok';
    case 'red': return 'behind';
    case 'gray': return 'inactive';
  }
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', backgroundColor: '#e5e7eb', border: 'none',
      borderRadius: 4, cursor: 'pointer', fontSize: 13,
    }}>{children}</button>
  );
}

const completeBtn: React.CSSProperties = {
  flex: '1 1 auto', padding: '5px 9px',
  backgroundColor: '#dcfce7', color: '#15803d',
  border: '1px solid #86efac', borderRadius: 4,
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const cancelBtn: React.CSSProperties = {
  flex: '1 1 auto', padding: '5px 9px',
  backgroundColor: '#fee2e2', color: '#b91c1c',
  border: '1px solid #fca5a5', borderRadius: 4,
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
