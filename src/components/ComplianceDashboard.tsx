import React, { useState, useMemo } from 'react';
import { Appointment, ScheduleData } from '../types';
import {
  ClientCompliance, TechCompliance, TechComplianceMetrics,
  computeClientCompliance, computeTechCompliance,
  pastIncompleteAppointments, monthPeriod,
} from '../compliance';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';

interface Props {
  data: ScheduleData;
  onMarkComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onSelectAppointment: (a: Appointment) => void;
}

export default function ComplianceDashboard({ data, onMarkComplete, onRequestCancel, onSelectAppointment }: Props) {
  const [periodRef, setPeriodRef] = useState(new Date());
  const period = useMemo(() => monthPeriod(periodRef), [periodRef]);
  const clientReports = useMemo(() => computeClientCompliance(data, period), [data, period]);
  const techReports = useMemo(() => computeTechCompliance(data, period), [data, period]);
  const pastIncomplete = useMemo(() => pastIncompleteAppointments(data), [data]);
  const targetPct = data.settings.supervisionDirectHoursPercent || 5;
  const techTargetPct = data.settings.supervisionTechHoursPercent ?? 0;

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
        Counted as overlap minutes between a supervision tagged with the client and
        any direct session for that client (any tech). A supervision with no
        overlapping direct (BCBA solo with the client) consumes BCBA time but
        contributes 0 to compliance.
      </p>

      {pastIncomplete.length > 0 && (
        <PastIncomplete
          items={pastIncomplete}
          onMarkComplete={onMarkComplete}
          onRequestCancel={onRequestCancel}
          onSelect={onSelectAppointment}
        />
      )}

      <SectionHeader>Per client</SectionHeader>
      <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        {clientReports.length === 0 && (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
            No clients yet. Add clients in Admin to start tracking compliance.
          </p>
        )}
        {clientReports.map(r => <ClientCard key={r.client.id} report={r} targetPct={targetPct} />)}
      </div>

      <SectionHeader>Per technician</SectionHeader>
      <p style={{ fontSize: 12, color: '#6b7280', marginTop: -8, marginBottom: 8 }}>
        RBTs must hit BACB <strong>{BACB_RBT_SUPERVISION_MIN_PERCENT}%</strong> AND the
        company target ({data.settings.supervisionRBTHoursPercent}%).
        Non-RBT techs follow the company-only target ({techTargetPct}%).
        Numerator counts supervision time overlapping that tech's direct sessions
        regardless of which client the supervision was tagged with.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {techReports.length === 0 && (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
            No technicians yet.
          </p>
        )}
        {techReports.map(r => <TechCard key={r.tech.id} report={r} />)}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
      color: '#374151', margin: '0 0 8px',
    }}>{children}</h3>
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

  const accentColor = statusColor(status);

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

function TechCard({ report }: { report: TechCompliance }) {
  const { tech, actual, projected } = report;
  const noDirect = actual.directHours === 0 && projected.directHours === 0;

  // A tech misses if they fall short on EITHER applicable threshold (BACB
  // for RBTs and/or company). Status uses the tighter of actual + projected.
  const status = techStatus(actual, projected, tech.isRBT, noDirect);
  const accent = statusColor(status);

  return (
    <div style={{
      backgroundColor: 'white',
      border: `2px solid ${accent}`,
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          {tech.name}
          <span style={{
            marginLeft: 6, fontSize: 10, fontWeight: 700,
            color: '#6b7280', backgroundColor: '#e5e7eb',
            padding: '2px 6px', borderRadius: 8,
          }}>{tech.isRBT ? 'RBT' : 'BT'}</span>
        </h3>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          color: 'white', backgroundColor: accent,
          padding: '2px 8px', borderRadius: 10,
        }}>{statusLabel(status)}</span>
      </div>

      {noDirect ? (
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          No direct sessions this period — nothing to supervise.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <TechMetric title="Actual" m={actual} accent={accent} isRBT={tech.isRBT} />
          <TechMetric title="Projected" m={projected} accent={accent} isRBT={tech.isRBT} />
        </div>
      )}
    </div>
  );
}

function TechMetric({ title, m, accent, isRBT }: {
  title: string;
  m: TechComplianceMetrics;
  accent: string;
  isRBT: boolean;
}) {
  // Bar fills against whichever requirement is HIGHER (the binding one) so the
  // user sees how far they are from passing both checks.
  const bindingPct = isRBT
    ? Math.max(BACB_RBT_SUPERVISION_MIN_PERCENT, m.companyRequiredPct)
    : m.companyRequiredPct;
  const fillPct = bindingPct > 0 ? Math.min(100, (m.pct / bindingPct) * 100) : 0;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>
        {m.pct.toFixed(1)}%
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
        {isRBT && m.bacbRequiredHours !== undefined && (
          <div>
            BACB {BACB_RBT_SUPERVISION_MIN_PERCENT}%: need <strong>{m.bacbRequiredHours.toFixed(1)}h</strong>
            {m.bacbHoursToGo! > 0
              ? <> · to go <strong style={{ color: accent }}>{m.bacbHoursToGo!.toFixed(1)}h</strong></>
              : <> · ✓</>}
          </div>
        )}
        <div>
          Company {m.companyRequiredPct}%: need <strong>{m.companyRequiredHours.toFixed(1)}h</strong>
          {m.companyHoursToGo > 0
            ? <> · to go <strong style={{ color: accent }}>{m.companyHoursToGo.toFixed(1)}h</strong></>
            : <> · ✓</>}
        </div>
      </div>
    </div>
  );
}

function techStatus(
  actual: TechComplianceMetrics,
  projected: TechComplianceMetrics,
  isRBT: boolean,
  noDirect: boolean,
): 'green' | 'yellow' | 'red' | 'gray' {
  if (noDirect) return 'gray';
  const passes = (m: TechComplianceMetrics) => {
    const bacbOk = !isRBT || (m.bacbHoursToGo ?? 0) === 0;
    const companyOk = m.companyHoursToGo === 0;
    return bacbOk && companyOk;
  };
  if (passes(actual)) return 'green';
  if (passes(projected)) return 'yellow';
  return 'red';
}

function statusColor(s: 'green' | 'yellow' | 'red' | 'gray'): string {
  return s === 'green' ? '#15803d'
    : s === 'yellow' ? '#a16207'
    : s === 'red' ? '#b91c1c'
    : '#6b7280';
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
