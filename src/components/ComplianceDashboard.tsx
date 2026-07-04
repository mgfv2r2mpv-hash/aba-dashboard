import React, { useState, useMemo } from 'react';
import { Appointment, ScheduleData, ScheduleConflict, WishSolution } from '../types';
import {
  ClientCompliance, TechCompliance, TechComplianceMetrics,
  computeClientCompliance, computeTechCompliance, computeTechContactDays,
  pastIncompleteAppointments, monthPeriod,
} from '../compliance';
import { ComplianceCache } from '../complianceCache';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
import {
  ActualLevel, ProjectedLevel,
  getActualLevel, getProjectedLevel, actualSectionStatus, projectedSectionStatus,
} from '../caseStatus';
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
  const btMinContacts = data.settings.techMinContactsPerMonth ?? 1;
  const pastIncomplete = useMemo(() => pastIncompleteAppointments(data), [data]);
  const targetPct = data.settings.supervisionDirectHoursPercent || 5;
  const companyPreferredPct = data.settings.supervisionPreferredMinPercent ?? 15;
  const companyPreferredMaxPct = data.settings.supervisionPreferredMaxPercent ?? 20;
  // Per-client override falls back to the company-wide preferred minimum.
  const clientPreferredPct = (client: { supervisionIdealPct?: number }) =>
    client.supervisionIdealPct ?? companyPreferredPct;
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
        background: compView === v ? 'var(--sage-600)' : 'transparent',
        color: compView === v ? 'var(--white)' : 'var(--text-body)',
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
            {[...clientReports].sort((a, b) => {
              const aPref = clientPreferredPct(a.client);
              const bPref = clientPreferredPct(b.client);
              const aLevel = getActualLevel(a.actual.directHours, a.actual.pct, targetPct, aPref, companyPreferredMaxPct, maxPct);
              const bLevel = getActualLevel(b.actual.directHours, b.actual.pct, targetPct, bPref, companyPreferredMaxPct, maxPct);
              const aPLevel = getProjectedLevel(a.projected.directHours, a.projected.pct, targetPct, aPref, companyPreferredMaxPct, maxPct);
              const bPLevel = getProjectedLevel(b.projected.directHours, b.projected.pct, targetPct, bPref, companyPreferredMaxPct, maxPct);
              const aNoDirect = a.actual.directHours === 0 && a.projected.directHours === 0;
              const bNoDirect = b.actual.directHours === 0 && b.projected.directHours === 0;
              const aCrit = overallBadge(aLevel, aPLevel, aNoDirect, a.actual.pct, a.projected.pct, targetPct, aPref, companyPreferredMaxPct, maxPct).isCritical;
              const bCrit = overallBadge(bLevel, bPLevel, bNoDirect, b.actual.pct, b.projected.pct, targetPct, bPref, companyPreferredMaxPct, maxPct).isCritical;
              if (aCrit !== bCrit) return aCrit ? -1 : 1;
              return a.client.name.localeCompare(b.client.name);
            }).map(r => <ClientCard key={r.client.id} report={r} targetPct={targetPct} preferredPct={clientPreferredPct(r.client)} preferredMaxPct={companyPreferredMaxPct} maxPct={maxPct} />)}
          </div>
        </>
      )}

      {compView === 'staff' && (
        <>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            RBTs must hit BACB <strong>{BACB_RBT_SUPERVISION_MIN_PERCENT}%</strong> AND the company target ({data.settings.supervisionRBTHoursPercent}%),
            plus ≥{rbtMinContacts} supervision contacts/month.
            Non-RBT BTs follow the company-only target ({techTargetPct}%) and require ≥{btMinContacts} contact(s)/month if they have direct sessions.
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
                btMinContacts={btMinContacts}
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
      backgroundColor: 'var(--status-pace-bg)', border: '1px solid var(--status-pace)',
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
          fontSize: 13, fontWeight: 600, color: 'var(--sage-700)', cursor: 'pointer',
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

// Supervision-band thresholds, levels, and section badges now live in
// ../caseStatus (shared with the Cases home-screen table).

type BadgeResult = { text: string; bgColor: string; cardBg?: string; isCritical: boolean; isAmazing: boolean };
const mkBadge = (text: string, bgColor: string, cardBg?: string, isCritical = false, isAmazing = false): BadgeResult =>
  ({ text, bgColor, cardBg, isCritical, isAmazing });

// Colours used in overallBadge.
const BADGE_RED        = 'var(--status-behind)'; // Critical / High Risk
const BADGE_RED_CARD   = 'var(--status-behind-bg)';
const BADGE_AMBER_WARM = 'var(--status-pace)'; // At Risk (yellow-orange)
const BADGE_AMBER      = '#a16207'; // At Risk (yellow) — no direct token
const BADGE_YG         = '#65a30d'; // Projected Good / Projected High (yellow-green) — no direct token
const BADGE_GREEN      = 'var(--status-met)'; // Projected Good (green) / Projected Ideal
const BADGE_GREEN_CARD = 'var(--status-met-bg)';
const BADGE_ORANGE_RED = 'var(--status-over)'; // Over/Over → High

// Helper: how far below the company min is the projected pct?
// Used for Behind-projection calculations.
const belowMin = (projPct: number, minPct: number) => minPct - projPct;

// Overall card badge — full 5×5 matrix with calculation cells.
function overallBadge(
  actual: ActualLevel,
  projected: ProjectedLevel,
  noDirect: boolean,
  actualPct: number,
  projectedPct: number,
  companyMinPct: number,
  preferredMinPct: number,
  preferredMaxPct: number,
  insurerCapPct?: number,
): BadgeResult {
  if (noDirect) return mkBadge('Inactive', '#6b7280');

  // No actual hours yet — judge by projected only.
  if (actual === 'na') {
    switch (projected) {
      case 'behind': return mkBadge('Behind', BADGE_RED);
      case 'risky':  return mkBadge('At Risk', BADGE_AMBER);
      case 'ok':     return mkBadge('Projected Good', BADGE_GREEN);
      case 'ideal':  return mkBadge('Projected Ideal', BADGE_GREEN, BADGE_GREEN_CARD);
      case 'high':   return mkBadge('Projected High', BADGE_YG);
      case 'over':   return mkBadge('Projected High', BADGE_YG);
    }
  }

  // Helper for projected-Behind severity based on how far below the floor.
  const behindSeverity = (gap: number, atRiskColor: string): BadgeResult =>
    gap > 10 ? mkBadge('Critical',   BADGE_RED, BADGE_RED_CARD, true)
  : gap >= 5  ? mkBadge('High Risk', BADGE_RED)
  :             mkBadge('At Risk',   atRiskColor);

  switch (actual) {

    case 'behind':
      switch (projected) {
        case 'behind': return mkBadge('Critical', BADGE_RED, BADGE_RED_CARD, true);
        case 'risky':
        case 'ok':     return mkBadge('High Risk', BADGE_RED);
        case 'ideal':  return mkBadge('At Risk', BADGE_AMBER);
        case 'high': {
          const margin = projectedPct - companyMinPct;
          return margin >= 10
            ? mkBadge('Projected Good', BADGE_YG)
            : mkBadge('At Risk', BADGE_AMBER);
        }
        case 'over': {
          if (insurerCapPct === undefined) return mkBadge('At Risk', BADGE_AMBER);
          return projectedPct - insurerCapPct >= 10
            ? mkBadge('At Risk', BADGE_AMBER)
            : mkBadge('Projected Good', BADGE_YG);
        }
      }
      break;

    case 'good':
      switch (projected) {
        case 'behind': {
          const gap = belowMin(projectedPct, companyMinPct);
          return gap >= 10
            ? mkBadge('Critical', BADGE_RED, BADGE_RED_CARD, true)
            : mkBadge('At Risk', CAP_OVER);
        }
        case 'risky':
        case 'ok':    return mkBadge('Projected Good', BADGE_GREEN);
        case 'ideal': return mkBadge('Projected Good', BADGE_GREEN);
        case 'high': {
          // Projected Ideal if projected − 5% still lands in the ideal band.
          const adjPct = projectedPct - 5;
          return (adjPct >= preferredMinPct && adjPct <= preferredMaxPct)
            ? mkBadge('Projected Ideal', BADGE_GREEN, BADGE_GREEN_CARD)
            : mkBadge('Projected High', BADGE_YG);
        }
        case 'over': return mkBadge('Projected High', BADGE_YG);
      }
      break;

    case 'ideal':
      switch (projected) {
        case 'behind': return behindSeverity(belowMin(projectedPct, companyMinPct), BADGE_AMBER_WARM);
        case 'risky':
        case 'ok':     return mkBadge('Projected Good', BADGE_GREEN);
        case 'ideal':  return mkBadge('✨ Amazing', BADGE_GREEN, BADGE_GREEN_CARD, false, true);
        case 'high':   return mkBadge('Projected High', BADGE_YG);
        case 'over':   return mkBadge('At Risk', BADGE_AMBER);
      }
      break;

    case 'high':
      switch (projected) {
        case 'behind': return behindSeverity(belowMin(projectedPct, companyMinPct), BADGE_AMBER);
        case 'risky':
        case 'ok':     return mkBadge('Projected Good', BADGE_GREEN);
        case 'ideal': {
          // Solidly in ideal (≥ 3% above preferred min) → Projected Ideal; barely → Projected Good.
          return (projectedPct - preferredMinPct >= 3)
            ? mkBadge('Projected Ideal', BADGE_GREEN, BADGE_GREEN_CARD)
            : mkBadge('Projected Good', BADGE_GREEN);
        }
        case 'high':  return mkBadge('Projected High', BADGE_YG);
        case 'over':  return mkBadge('At Risk', BADGE_AMBER);
      }
      break;

    case 'over':
      switch (projected) {
        case 'behind': return behindSeverity(belowMin(projectedPct, companyMinPct), BADGE_AMBER_WARM);
        case 'risky':
        case 'ok':     return mkBadge('Projected Good', BADGE_GREEN);
        case 'ideal': {
          if (insurerCapPct === undefined) return mkBadge('Projected Ideal', BADGE_GREEN, BADGE_GREEN_CARD);
          return (actualPct - insurerCapPct >= 10)
            ? mkBadge('At Risk', BADGE_AMBER)
            : mkBadge('Projected Ideal', BADGE_GREEN, BADGE_GREEN_CARD);
        }
        case 'high':  return mkBadge('At Risk', BADGE_AMBER);
        case 'over':  return mkBadge('High', BADGE_ORANGE_RED);
      }
      break;
  }

  return mkBadge('Unknown', '#6b7280');
}

function ClientCard({ report, targetPct, preferredPct, preferredMaxPct, maxPct }: {
  report: ClientCompliance; targetPct: number; preferredPct: number; preferredMaxPct: number; maxPct?: number;
}) {
  const { client, actual, projected } = report;
  const noDirect = actual.directHours === 0 && projected.directHours === 0;

  const aLevel = getActualLevel(actual.directHours, actual.pct, targetPct, preferredPct, preferredMaxPct, maxPct);
  const pLevel = getProjectedLevel(projected.directHours, projected.pct, targetPct, preferredPct, preferredMaxPct, maxPct);
  const badge = overallBadge(aLevel, pLevel, noDirect, actual.pct, projected.pct, targetPct, preferredPct, preferredMaxPct, maxPct);
  const actualStatus = actualSectionStatus(aLevel);
  const projStatus = projectedSectionStatus(pLevel);

  return (
    <div style={{
      backgroundColor: badge.cardBg ?? 'white',
      border: `2px solid ${badge.bgColor}`,
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{client.name}</h3>
        <span style={{
          fontSize: 11, fontWeight: 700,
          textTransform: badge.isAmazing ? undefined : 'uppercase',
          color: 'white', backgroundColor: badge.bgColor,
          padding: '2px 10px', borderRadius: 10,
          boxShadow: badge.isAmazing ? '0 0 0 2px #86efac' : undefined,
        }}>{badge.text}</span>
      </div>

      {noDirect ? (
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          No direct sessions in {monthLabel(report)}. Nothing to supervise.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'start' }}>
          <Metric title="Actual" m={actual} targetPct={targetPct} preferredPct={preferredPct} preferredMaxPct={preferredMaxPct} sectionStatus={actualStatus} maxPct={maxPct} />
          <Metric title="Projected" m={projected} targetPct={targetPct} preferredPct={preferredPct} preferredMaxPct={preferredMaxPct} sectionStatus={projStatus} maxPct={maxPct} />
        </div>
      )}
    </div>
  );
}

function TechCard({ report, maxPct, contacts, rbtMinContacts, btMinContacts }: {
  report: TechCompliance;
  maxPct?: number;
  contacts?: { actual: number; projected: number };
  rbtMinContacts?: number;
  btMinContacts?: number;
}) {
  const { tech, actual, projected } = report;
  const noDirect = actual.directHours === 0 && projected.directHours === 0;
  const minContacts = tech.isRBT ? (rbtMinContacts ?? 2) : (btMinContacts ?? 1);
  const contactsRequired = !noDirect ? minContacts : 0;
  const actualContactsBehind = contacts !== undefined && contactsRequired > 0 && contacts.actual < contactsRequired;
  const projectedContactsBehind = contacts !== undefined && contactsRequired > 0 && contacts.projected < contactsRequired;

  const status = techStatus(actual, projected, tech.isRBT, noDirect);
  const overallStatus = (status === 'green' && projectedContactsBehind) ? 'atRisk'
    : (status === 'yellow' && projectedContactsBehind) ? 'red'
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
            <TechMetric title="Actual" m={actual} accent={accent} isRBT={tech.isRBT} maxPct={maxPct} sectionStatus={techHalfStatus(actual, tech.isRBT)} />
            <TechMetric title="Projected" m={projected} accent={accent} isRBT={tech.isRBT} maxPct={maxPct} sectionStatus={techHalfStatus(projected, tech.isRBT)} />
          </div>
          {contacts !== undefined && contactsRequired > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
              Supervision contacts: <strong style={{ color: actualContactsBehind ? 'var(--text-muted)' : 'var(--status-met)' }}>
                {contacts.actual} actual
              </strong>
              {' / '}
              <strong style={{ color: projectedContactsBehind ? 'var(--status-behind)' : 'var(--status-met)' }}>
                {contacts.projected} projected
              </strong>
              {' '}(need {contactsRequired}/month)
              {projectedContactsBehind && <span style={{ color: 'var(--status-behind)', fontWeight: 600 }}> — behind</span>}
              {!projectedContactsBehind && <span style={{ color: 'var(--status-met)' }}> ✓</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function techHalfStatus(m: TechComplianceMetrics, isRBT: boolean): { text: string; color: string } {
  const bacbOk = !isRBT || (m.bacbHoursToGo ?? 0) <= 0;
  const companyOk = m.companyHoursToGo <= 0;
  if (bacbOk && companyOk) return { text: 'On Track', color: 'var(--status-met)' };
  if (isRBT && (bacbOk || companyOk)) return { text: 'Partial', color: 'var(--status-pace)' };
  return { text: 'Behind', color: 'var(--status-behind)' };
}

function TechMetric({ title, m, accent, isRBT, maxPct, sectionStatus }: {
  title: string;
  m: TechComplianceMetrics;
  accent: string;
  isRBT: boolean;
  maxPct?: number;
  sectionStatus?: { text: string; color: string };
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
        {m.pct.toFixed(1)}%{overCap && <span style={{ fontSize: 14 }}> ⚠️</span>}
      </div>
      {sectionStatus && (
        <div style={{ height: 22, display: 'flex', alignItems: 'center', marginTop: 3 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            color: 'white', backgroundColor: sectionStatus.color,
            padding: '2px 7px', borderRadius: 8,
          }}>{sectionStatus.text}</span>
        </div>
      )}
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
): 'green' | 'atRisk' | 'yellow' | 'red' | 'gray' {
  if (noDirect) return 'gray';
  const passes = (m: TechComplianceMetrics) => {
    const bacbOk = !isRBT || (m.bacbHoursToGo ?? 0) === 0;
    const companyOk = m.companyHoursToGo === 0;
    return bacbOk && companyOk;
  };
  const actualGood = passes(actual);
  const projectedGood = passes(projected);
  if (actualGood && projectedGood) return 'green';
  if (actualGood && !projectedGood) return 'atRisk';
  if (!actualGood && projectedGood) return 'yellow';
  return 'red';
}

function statusColor(s: 'green' | 'atRisk' | 'yellow' | 'red' | 'gray'): string {
  return s === 'green' ? 'var(--status-met)'
    : s === 'atRisk' ? 'var(--status-over)'
    : s === 'yellow' ? 'var(--status-pace)'
    : s === 'red' ? 'var(--status-behind)'
    : 'var(--text-muted)';
}


// Distinct from the green/yellow/red status colors so the over-cap warning
// doesn't get confused with the under-min status pill.
const CAP_OVER = 'var(--status-over)';

function Metric({ title, m, targetPct, preferredPct, preferredMaxPct, sectionStatus, maxPct }: {
  title: string;
  m: { directHours: number; supervisionHours: number; requiredHours: number; pct: number; hoursToGo: number };
  targetPct: number;
  preferredPct: number;
  preferredMaxPct: number;
  sectionStatus: { text: string; color: string };
  maxPct?: number;
}) {
  const overCap = maxPct !== undefined && m.pct > maxPct;
  const overPrefMax = !overCap && m.pct > preferredMaxPct;
  const fillPct = Math.min(100, (m.pct / targetPct) * 100);
  const { color: statusColor, text: statusText } = sectionStatus;
  const label = overCap ? `of ${maxPct}% cap ⚠️`
    : overPrefMax ? `of ${preferredMaxPct}% pref. max`
    : `of ${preferredPct}% target`;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 2 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: statusColor }}>
          {m.pct.toFixed(1)}%
        </span>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
          {label}
        </span>
      </div>
      {/* Badge on fixed-height row — keeps bar vertically aligned across columns */}
      <div style={{ height: 22, display: 'flex', alignItems: 'center', marginTop: 3 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          color: 'white', backgroundColor: statusColor,
          padding: '2px 7px', borderRadius: 8,
        }}>{statusText}</span>
      </div>
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

function statusLabel(s: 'green' | 'atRisk' | 'yellow' | 'red' | 'gray'): string {
  switch (s) {
    case 'green': return 'on track';
    case 'atRisk': return 'at risk';
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
  backgroundColor: 'var(--status-behind-bg)', color: 'var(--status-behind)',
  border: '1px solid var(--red-300)', borderRadius: 4,
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
