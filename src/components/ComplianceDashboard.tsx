import React, { useState, useMemo } from 'react';
import { Appointment, ScheduleData, ScheduleConflict, WishSolution } from '../types';
import {
  ClientCompliance, TechCompliance, TechComplianceMetrics,
  computeClientCompliance, computeTechCompliance, computeTechContactDays,
  pastIncompleteAppointments, monthPeriod,
} from '../compliance';
import { ComplianceCache } from '../complianceCache';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
import CompleteTimePrompt from './CompleteTimePrompt';
import ConflictPanel from './ConflictPanel';
import FixItPanel from './FixItPanel';
import { AISettings } from './Settings';

interface Props {
  data: ScheduleData;
  // Live per-entity cache for the current month, maintained incrementally by
  // App. When the viewed period is the cached one, read from it (instant +
  // consistent with the header badge); other months compute on demand.
  cache?: ComplianceCache | null;
  // Calendar-scoped schedule warnings (errors/warnings), shown in a collapsible
  // area so the Compliance tab is the one place to see everything that needs
  // attention. May be omitted (treated as none).
  conflicts?: ScheduleConflict[];
  aiSettings?: AISettings;
  // Conflict triage (mute / confirm-dismiss), owned by App and threaded to the
  // warnings ConflictPanel so it stays consistent with the schedule view's.
  mutedConflictKeys?: string[];
  onMuteConflict?: (key: string) => void;
  onUnmuteConflict?: (key: string) => void;
  onConfirmDismissConflict?: (key: string) => void;
  onMarkComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onSelectAppointment: (a: Appointment) => void;
  // "Fix It" actions — accept applies a proposed solution; customize stages it
  // into the editable draft. Optional (the panel hides its buttons without them).
  onAcceptFix?: (sol: WishSolution) => void | Promise<void>;
  onCustomizeFix?: (sol: WishSolution) => void;
}

export default function ComplianceDashboard({ data, cache, conflicts = [], aiSettings, mutedConflictKeys, onMuteConflict, onUnmuteConflict, onConfirmDismissConflict, onMarkComplete, onRequestCancel, onSelectAppointment, onAcceptFix, onCustomizeFix }: Props) {
  const [periodRef, setPeriodRef] = useState(new Date());
  const [compView, setCompView] = useState<'case' | 'staff'>('case');
  const period = useMemo(() => monthPeriod(periodRef), [periodRef]);
  const usingCache = !!cache && cache.period.start.getTime() === period.start.getTime();
  const clientReports = useMemo(
    () => usingCache
      ? data.clients.map(c => cache!.clients.get(c.id)).filter((r): r is ClientCompliance => !!r)
      : computeClientCompliance(data, period),
    [data, period, cache, usingCache],
  );
  const techReports = useMemo(
    () => usingCache
      ? data.technicians.map(t => cache!.techs.get(t.id)).filter((r): r is TechCompliance => !!r)
      : computeTechCompliance(data, period),
    [data, period, cache, usingCache],
  );
  const techContactDays = useMemo(() => {
    const map = new Map<string, { actual: number; projected: number }>();
    for (const tech of data.technicians) {
      map.set(tech.id, {
        actual: computeTechContactDays(data, tech, period, 'actual'),
        projected: computeTechContactDays(data, tech, period, 'projected'),
      });
    }
    return map;
  }, [data, period]);
  const rbtMinContacts = data.settings.rbtMinContactsPerMonth ?? 2;
  const pastIncomplete = useMemo(() => pastIncompleteAppointments(data), [data]);
  const targetPct = data.settings.supervisionDirectHoursPercent || 5;
  const preferredPct = data.settings.supervisionPreferredMinPercent ?? 15;
  const techTargetPct = data.settings.supervisionTechHoursPercent ?? 0;
  const maxPct = data.settings.supervisionMaxHoursPercent;

  const goPrev = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() - 1, 1));
  const goNext = () => setPeriodRef(new Date(periodRef.getFullYear(), periodRef.getMonth() + 1, 1));
  const goToday = () => setPeriodRef(new Date());

  const tabBtn = (v: 'case' | 'staff', label: string) => (
    <button
      onClick={() => setCompView(v)}
      style={{
        padding: '5px 14px', border: 'none', borderRadius: 5, cursor: 'pointer',
        fontSize: 13, fontWeight: 600,
        background: compView === v ? '#1d4ed8' : 'transparent',
        color: compView === v ? 'white' : '#374151',
      }}
    >{label}</button>
  );

  return (
    <div style={{ flex: 1, padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Compliance ({period.label})</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 6, padding: 2, marginRight: 4 }}>
            {tabBtn('case', 'Cases')}
            {tabBtn('staff', 'Staff')}
          </div>
          <NavBtn onClick={goPrev}>←</NavBtn>
          <NavBtn onClick={goToday}>Today</NavBtn>
          <NavBtn onClick={goNext}>→</NavBtn>
        </div>
      </div>

      {aiSettings && onAcceptFix && onCustomizeFix && (
        <FixItPanel
          data={data}
          aiSettings={aiSettings}
          conflicts={conflicts}
          onAccept={onAcceptFix}
          onCustomize={onCustomizeFix}
        />
      )}

      {conflicts.length > 0 && (
        <ScheduleWarnings
          conflicts={conflicts}
          appointments={data.appointments}
          onSelect={onSelectAppointment}
          mutedConflictKeys={mutedConflictKeys}
          onMuteConflict={onMuteConflict}
          onUnmuteConflict={onUnmuteConflict}
          onConfirmDismissConflict={onConfirmDismissConflict}
        />
      )}

      {pastIncomplete.length > 0 && (
        <PastIncomplete
          items={pastIncomplete}
          onMarkComplete={onMarkComplete}
          onRequestCancel={onRequestCancel}
          onSelect={onSelectAppointment}
        />
      )}

      {compView === 'case' && (
        <>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Supervision target: <strong>{targetPct}%</strong> of direct hours per client.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {clientReports.length === 0 && (
              <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
                No clients yet. Add clients in Admin to start tracking compliance.
              </p>
            )}
            {clientReports.map(r => <ClientCard key={r.client.id} report={r} targetPct={targetPct} preferredPct={preferredPct} maxPct={maxPct} />)}
          </div>
        </>
      )}

      {compView === 'staff' && (
        <>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            RBTs must hit BACB <strong>{BACB_RBT_SUPERVISION_MIN_PERCENT}%</strong> AND the company target ({data.settings.supervisionRBTHoursPercent}%),
            plus ≥{rbtMinContacts} supervision contacts/month.
            Non-RBT BTs follow the company-only target ({techTargetPct}%) and require ≥1 contact/month if they have direct sessions.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {techReports.length === 0 && (
              <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
                No technicians yet.
              </p>
            )}
            {techReports.map(r => (
              <TechCard
                key={r.tech.id}
                report={r}
                maxPct={maxPct}
                contacts={techContactDays.get(r.tech.id)}
                rbtMinContacts={rbtMinContacts}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The calendar's schedule warnings, surfaced on the Compliance tab in a
// collapsible area (collapsed by default so the compliance cards lead). Reuses
// ConflictPanel — which carries the per-conflict confirm/mute controls.
function ScheduleWarnings({ conflicts, appointments, onSelect, mutedConflictKeys, onMuteConflict, onUnmuteConflict, onConfirmDismissConflict }: {
  conflicts: ScheduleConflict[];
  appointments: Appointment[];
  onSelect: (a: Appointment) => void;
  mutedConflictKeys?: string[];
  onMuteConflict?: (key: string) => void;
  onUnmuteConflict?: (key: string) => void;
  onConfirmDismissConflict?: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div style={{ marginBottom: 16, border: '1px solid #fcd34d', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%', background: '#fffbeb', border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 700, color: '#92400e', padding: '10px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}
      >
        <span>⚠️ Schedule warnings ({conflicts.length})</span>
        <span>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <ConflictPanel
          conflicts={conflicts}
          appointments={appointments}
          onSelectAppointment={onSelect}
          mutedKeys={mutedConflictKeys}
          onMute={onMuteConflict}
          onUnmute={onUnmuteConflict}
          onConfirmDismiss={onConfirmDismissConflict}
        />
      )}
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
            Incomplete past appointments count toward compliance until canceled
            or deleted. Convert these in a timely manner for most accurate
            compliance tracking.
          </p>
          {items.map(a => (
            <PastIncompleteRow
              key={a.id}
              a={a}
              onMarkComplete={onMarkComplete}
              onRequestCancel={onRequestCancel}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// A single past-incomplete row. ✓ Complete opens an inline editor prefilled
// with the scheduled start/end so the user nudges them to the actual rendered
// times before accepting (one tap accepts unchanged). Speed matters: this is
// the high-frequency path for matching the roll to delivered minutes.
function PastIncompleteRow({ a, onMarkComplete, onRequestCancel, onSelect }: {
  a: Appointment;
  onMarkComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onSelect: (a: Appointment) => void;
}) {
  return (
    <div style={{
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <CompleteTimePrompt a={a} onComplete={onMarkComplete} />
        <button onClick={() => onRequestCancel(a)} style={cancelBtn}>✕ Cancel</button>
      </div>
    </div>
  );
}

// ---------- Per-client card ----------

// "Within 2 percentage-points of the minimum" → Risky.
const RISKY_MARGIN = 2;

// Status for the ACTUAL supervision section — always non-null so a badge is always shown.
function actualSectionStatus(pct: number, targetPct: number, preferredPct: number, maxPct?: number): { text: string; color: string } {
  if (maxPct !== undefined && pct > maxPct) return { text: 'Reduce', color: CAP_OVER };
  if (pct >= preferredPct) return { text: 'Ideal', color: '#15803d' };
  if (pct >= targetPct) return { text: 'Good', color: '#15803d' };
  return { text: 'Behind', color: '#b91c1c' };
}

// Status for the PROJECTED supervision section.
function projectedSectionStatus(pct: number, targetPct: number, preferredPct: number, maxPct?: number): { text: string; color: string } {
  if (maxPct !== undefined && pct > maxPct) return { text: 'Over Cap', color: CAP_OVER };
  if (pct >= preferredPct && (maxPct === undefined || pct <= maxPct)) return { text: 'Ideal', color: '#15803d' };
  if (pct >= targetPct + RISKY_MARGIN) return { text: 'OK', color: '#15803d' };
  return { text: 'Risky', color: '#b91c1c' };
}

// Overall card badge — driven by projected (end-of-period outcome).
function clientCardBadge(
  actual: { pct: number },
  projected: { pct: number },
  targetPct: number,
  preferredPct: number,
  maxPct: number | undefined,
  noDirect: boolean,
): { text: string; bgColor: string } {
  if (noDirect) return { text: 'Inactive', bgColor: '#6b7280' };
  if (actual.pct < targetPct && projected.pct < targetPct)
    return { text: 'Critical', bgColor: '#b91c1c' };
  if (projected.pct < targetPct + RISKY_MARGIN)
    return { text: 'Risky', bgColor: '#b91c1c' };
  if (maxPct !== undefined && actual.pct > maxPct)
    return { text: 'Reduce', bgColor: CAP_OVER };
  if (projected.pct >= preferredPct && (maxPct === undefined || projected.pct <= maxPct))
    return { text: 'Ideal', bgColor: '#15803d' };
  return { text: 'OK', bgColor: '#15803d' };
}

function ClientCard({ report, targetPct, preferredPct, maxPct }: { report: ClientCompliance; targetPct: number; preferredPct: number; maxPct?: number }) {
  const { client, actual, projected } = report;
  const noDirect = actual.directHours === 0 && projected.directHours === 0;

  const badge = clientCardBadge(actual, projected, targetPct, preferredPct, maxPct, noDirect);
  const actualStatus = actualSectionStatus(actual.pct, targetPct, preferredPct, maxPct);
  const projStatus = projectedSectionStatus(projected.pct, targetPct, preferredPct, maxPct);

  const cardBorderColor = badge.bgColor;

  return (
    <div style={{
      backgroundColor: badge.bgColor === '#b91c1c' ? '#fff5f5' : 'white',
      border: `2px solid ${cardBorderColor}`,
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{client.name}</h3>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          color: 'white', backgroundColor: badge.bgColor,
          padding: '2px 8px', borderRadius: 10,
        }}>{badge.text}</span>
      </div>

      {noDirect ? (
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          No direct sessions in {monthLabel(report)}. Nothing to supervise.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'start' }}>
          <Metric title="Actual" m={actual} targetPct={targetPct} sectionStatus={actualStatus} maxPct={maxPct} />
          <Metric title="Projected" m={projected} targetPct={targetPct} sectionStatus={projStatus} maxPct={maxPct} />
        </div>
      )}
    </div>
  );
}

function TechCard({ report, maxPct, contacts, rbtMinContacts }: {
  report: TechCompliance;
  maxPct?: number;
  contacts?: { actual: number; projected: number };
  rbtMinContacts?: number;
}) {
  const { tech, actual, projected } = report;
  const noDirect = actual.directHours === 0 && projected.directHours === 0;
  const minContacts = tech.isRBT ? (rbtMinContacts ?? 2) : 1;
  const contactsRequired = !noDirect ? minContacts : 0;
  const contactsBehind = contacts !== undefined && contactsRequired > 0 && contacts.projected < contactsRequired;

  const status = techStatus(actual, projected, tech.isRBT, noDirect);
  const overallStatus = (status === 'green' && contactsBehind) ? 'yellow'
    : (status === 'yellow' && contactsBehind) ? 'red'
    : status;
  const accent = statusColor(overallStatus);

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
        }}>{statusLabel(overallStatus)}</span>
      </div>

      {noDirect ? (
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          No direct sessions this period. Nothing to supervise.
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <TechMetric title="Actual" m={actual} accent={accent} isRBT={tech.isRBT} maxPct={maxPct} />
            <TechMetric title="Projected" m={projected} accent={accent} isRBT={tech.isRBT} maxPct={maxPct} />
          </div>
          {contacts !== undefined && contactsRequired > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
              Supervision contacts: <strong style={{ color: contactsBehind ? accent : '#15803d' }}>
                {contacts.actual} actual / {contacts.projected} projected
              </strong>
              {' '}(need {contactsRequired}/month)
              {contactsBehind && <span style={{ color: accent, fontWeight: 600 }}> — behind</span>}
              {!contactsBehind && contacts.projected >= contactsRequired && <span style={{ color: '#15803d' }}> ✓</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TechMetric({ title, m, accent, isRBT, maxPct }: {
  title: string;
  m: TechComplianceMetrics;
  accent: string;
  isRBT: boolean;
  maxPct?: number;
}) {
  // Bar fills against whichever requirement is HIGHER (the binding one) so the
  // user sees how far they are from passing both checks.
  const bindingPct = isRBT
    ? Math.max(BACB_RBT_SUPERVISION_MIN_PERCENT, m.companyRequiredPct)
    : m.companyRequiredPct;
  const fillPct = bindingPct > 0 ? Math.min(100, (m.pct / bindingPct) * 100) : 0;
  const overCap = maxPct !== undefined && m.pct > maxPct;
  const pctColor = overCap ? CAP_OVER : accent;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: pctColor }}>
        {m.pct.toFixed(1)}%
        {overCap && (
          <div style={{ fontSize: 11, color: CAP_OVER, fontWeight: 600, marginTop: 2 }}>
            ⚠ over {maxPct}% insurer cap
          </div>
        )}
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


// Distinct from the green/yellow/red status colors so the over-cap warning
// doesn't get confused with the under-min status pill.
const CAP_OVER = '#ea580c';

function Metric({ title, m, targetPct, sectionStatus, maxPct }: {
  title: string;
  m: { directHours: number; supervisionHours: number; requiredHours: number; pct: number; hoursToGo: number };
  targetPct: number;
  sectionStatus: { text: string; color: string };
  maxPct?: number;
}) {
  const fillPct = Math.min(100, (m.pct / targetPct) * 100);
  const { color: statusColor, text: statusText } = sectionStatus;
  return (
    <div>
      {/* Section title */}
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 2 }}>
        {title}
      </div>
      {/* Percentage + "of X% target" — no badge here so height is consistent */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: statusColor }}>
          {m.pct.toFixed(1)}%
        </span>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
          of {targetPct}% target
        </span>
      </div>
      {/* Badge on its own fixed-height row — keeps bar vertically aligned across columns */}
      <div style={{ height: 22, display: 'flex', alignItems: 'center', marginTop: 3 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          color: 'white', backgroundColor: statusColor,
          padding: '2px 7px', borderRadius: 8,
        }}>{statusText}</span>
      </div>
      {/* Bar — always at the same vertical position */}
      <div style={{ height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${fillPct}%`, backgroundColor: statusColor, transition: 'width 200ms' }} />
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
        Direct: <strong>{m.directHours.toFixed(1)}h</strong> ·
        Sup: <strong>{m.supervisionHours.toFixed(1)}h</strong>
        <br />
        Required: <strong>{m.requiredHours.toFixed(1)}h</strong>
        {m.hoursToGo > 0 && (
          <> · To go: <strong style={{ color: statusColor }}>{m.hoursToGo.toFixed(1)}h</strong></>
        )}
        {m.hoursToGo === 0 && m.directHours > 0 && (
          <> · ✓</>
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
    case 'green': return 'on track';
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

const cancelBtn: React.CSSProperties = {
  flex: '1 1 auto', padding: '5px 9px',
  backgroundColor: '#fee2e2', color: '#b91c1c',
  border: '1px solid #fca5a5', borderRadius: 4,
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
