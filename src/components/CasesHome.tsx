import { useMemo, useState, CSSProperties } from 'react';
import { Appointment, Client, ScheduleData } from '../types';
import { computeCaseState, CaseState } from '../caseModel';
import { computeClientCompliance, monthPeriod, ClientCompliance } from '../compliance';
import { analyzeCorrections, CorrectionNeed } from '../corrections';
import {
  getActualLevel, getProjectedLevel, actualSectionStatus, projectedSectionStatus,
  resolveSupervisionThresholds, computeCaseRisk, CaseRisk,
} from '../caseStatus';
import {
  computeCaseCancels, CaseCancelSummary, EntityCancels, CancelWindow,
  CANCEL_WINDOWS, CANCEL_WINDOW_LABELS, CANCEL_HEADLINE_WINDOW,
  cancelSeverityColor, cancelTypeAbbr,
} from '../caseCancels';

// Cases home screen — one row per case with the month projection (Risk),
// month/week utilization, per-entity cancel pressure (compact + popover),
// supervision % and parent-training (actual / projected), the supervision band
// status, and the compliance factors driving any flag. The per-row "Fix it"
// button is wired in Phase 3 (inert here unless onFixIt is provided).
interface Props {
  data: ScheduleData;
  now?: Date;
  onFixIt?: (clientId: string) => void;
}

interface Row {
  state: CaseState;
  compliance?: ClientCompliance;
  risk: CaseRisk;
  cancels: CaseCancelSummary;
  ptActual: number;
  factors: CorrectionNeed[];
}

const hrs = (n: number) => (Math.round(n * 10) / 10).toString();
const durationHours = (a: Appointment): number => {
  const ms = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
};
const matchesClient = (a: Appointment, c: Client): boolean => a.client === c.id || a.client === c.name;

export default function CasesHome({ data, now = new Date(), onFixIt }: Props) {
  const [popover, setPopover] = useState<{ caseName: string; cancels: CaseCancelSummary } | null>(null);

  const rows: Row[] = useMemo(() => {
    const period = monthPeriod(now);
    const compliance = computeClientCompliance(data, period, now);
    const complianceById = new Map(compliance.map(c => [c.client.id, c]));
    const cancels = computeCaseCancels(data, now);
    const report = analyzeCorrections(data, now);
    const factorsById = new Map<string, CorrectionNeed[]>();
    for (const n of report.needs) {
      if (!n.clientId) continue;
      const list = factorsById.get(n.clientId) || [];
      list.push(n);
      factorsById.set(n.clientId, list);
    }

    return data.clients.map(client => {
      const state = computeCaseState(data, client, now);
      const ptActual = data.appointments.filter(a =>
        a.type === 'parent-training' && a.status !== 'canceled' && matchesClient(a, client) &&
        new Date(a.startTime) >= period.start && new Date(a.startTime) < period.end &&
        new Date(a.startTime).getTime() <= now.getTime(),
      ).reduce((s, a) => s + durationHours(a), 0);
      return {
        state,
        compliance: complianceById.get(client.id),
        risk: computeCaseRisk(state),
        cancels: cancels.get(client.id)!,
        ptActual,
        factors: factorsById.get(client.id) || [],
      };
    });
  }, [data, now]);

  const monthLabel = rows[0]?.state.monthLabel || '';
  const HEADERS = ['Risk', 'Case', 'Util (Wk / Mo)', 'Cancels', 'Adm/BCBA', 'Sup % (A/P)', 'PT (A/P)', 'Status', 'Factors', ''];

  return (
    <div style={{ padding: '8px 4px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Cases ({monthLabel})</h2>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        Month projection per case: utilization, cancellations (tap a cell for the full breakdown),
        supervision % and parent training (actual / projected), status, and the factors driving each flag.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No clients yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb', color: '#374151' }}>
                {HEADERS.map((h, i) => (
                  <th key={i} style={{ padding: '6px 8px', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <CaseRow
                  key={r.state.client.id}
                  row={r}
                  settings={data.settings}
                  onOpenCancels={() => setPopover({ caseName: r.state.client.name, cancels: r.cancels })}
                  onFixIt={onFixIt}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {popover && (
        <CancelPopover
          caseName={popover.caseName}
          cancels={popover.cancels}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

const td: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };

function CaseRow({ row, settings, onOpenCancels, onFixIt }: {
  row: Row;
  settings: ScheduleData['settings'];
  onOpenCancels: () => void;
  onFixIt?: (clientId: string) => void;
}) {
  const { state: s, compliance, risk, cancels, ptActual } = row;
  const th = resolveSupervisionThresholds(settings, s.client);

  const act = compliance?.actual;
  const proj = compliance?.projected;
  const actLevel = getActualLevel(act?.directHours ?? 0, act?.pct ?? 0, th.targetPct, th.preferredPct, th.preferredMaxPct, th.maxPct);
  const projLevel = getProjectedLevel(proj?.directHours ?? 0, proj?.pct ?? 0, th.targetPct, th.preferredPct, th.preferredMaxPct, th.maxPct);
  const status = actualSectionStatus(actLevel);
  const projStatus = projectedSectionStatus(projLevel);

  const weekColor = s.direct.authPerWk === 0 ? '#9ca3af' : s.direct.belowTarget ? '#b45309' : '#15803d';
  const ptColor = s.parentTraining.goalMonth === 0 ? '#6b7280' : s.parentTraining.gap > 0.01 ? '#b45309' : '#15803d';

  return (
    <tr>
      {/* Risk */}
      <td style={td}>
        <span title={risk.reasons.join(' · ')} style={chip(risk.color)}>{risk.label}</span>
      </td>
      {/* Case */}
      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.client.name}</td>
      {/* Utilization week / month */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <div style={{ color: weekColor, fontWeight: 600 }}>
          {s.direct.authPerWk > 0 ? `${hrs(s.direct.actualThisWk)}/${hrs(s.direct.authPerWk)}h · ${Math.round(s.direct.pctOfAuth)}%` : `${hrs(s.direct.actualThisWk)}h`}
        </div>
        <div style={{ color: '#6b7280', fontSize: 11 }}>
          Mo {hrs(act?.directHours ?? 0)}/{hrs(proj?.directHours ?? 0)}h
        </div>
      </td>
      {/* Cancels — family + each BT, headline window, tap to expand */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <CancelCell entities={[cancels.family, ...cancels.bts]} onOpen={onOpenCancels} />
      </td>
      {/* Admin / BCBA cancels */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <CancelCell entities={[cancels.adminBcba]} onOpen={onOpenCancels} />
      </td>
      {/* Supervision % actual / projected */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <span style={{ color: status.color, fontWeight: 600 }}>{act && act.directHours > 0 ? `${hrs(act.pct)}%` : '—'}</span>
        <span style={{ color: '#9ca3af' }}> / </span>
        <span style={{ color: projStatus.color, fontWeight: 600 }}>{proj && proj.directHours > 0 ? `${hrs(proj.pct)}%` : '—'}</span>
      </td>
      {/* Parent training actual / projected (vs monthly goal) */}
      <td style={{ ...td, whiteSpace: 'nowrap', color: ptColor }}>
        {s.parentTraining.goalMonth > 0 || s.parentTraining.deliveredMonth > 0
          ? `${hrs(ptActual)}/${hrs(s.parentTraining.deliveredMonth)} · goal ${hrs(s.parentTraining.goalMonth)}h`
          : '—'}
      </td>
      {/* Supervision band status */}
      <td style={td}>
        <span style={chip(status.color)}>{status.text}</span>
      </td>
      {/* Factors */}
      <td style={{ ...td, minWidth: 200, maxWidth: 320, whiteSpace: 'normal' }}>
        {row.factors.length === 0 ? (
          <span style={{ color: '#15803d' }}>On pace</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {row.factors.map((f, i) => (
              <li key={i} style={{ color: f.priority === 1 ? '#b91c1c' : f.priority === 2 ? '#b45309' : '#6b7280', marginBottom: 2 }}>
                {stripSubject(f.detail, s.client.name)}
              </li>
            ))}
          </ul>
        )}
      </td>
      {/* Fix it (wired in Phase 3) */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button
          onClick={onFixIt ? () => onFixIt(s.client.id) : undefined}
          disabled={!onFixIt}
          title={onFixIt ? 'Fix it' : 'Coming in the per-case Fix-it dialog'}
          style={{
            padding: '4px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--brand-fix, #ea580c)',
            background: onFixIt ? 'var(--brand-fix, #ea580c)' : '#f3f4f6',
            color: onFixIt ? 'white' : '#9ca3af',
            cursor: onFixIt ? 'pointer' : 'not-allowed',
          }}
        >Fix it</button>
      </td>
    </tr>
  );
}

// Compact cell: one chip per entity showing the headline-window count, colored
// by severity. Tapping anywhere opens the full breakdown popover.
function CancelCell({ entities, onOpen }: { entities: EntityCancels[]; onOpen: () => void }) {
  const anyCancels = entities.some(e => CANCEL_WINDOWS.some(w => e.totals[w] > 0));
  return (
    <button
      onClick={onOpen}
      title="Tap for the full breakdown"
      style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      {entities.map(e => {
        const n = e.totals[CANCEL_HEADLINE_WINDOW];
        return (
          <span key={e.key} style={{
            display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 600,
            padding: '1px 5px', borderRadius: 4, background: '#f9fafb', color: cancelSeverityColor(n),
            border: '1px solid #f3f4f6',
          }}>{e.label}:{n}</span>
        );
      })}
      {!anyCancels && <span style={{ fontSize: 11, color: '#9ca3af' }}>none</span>}
    </button>
  );
}

// Full breakdown popover: entities × four windows, with per-type counts.
function CancelPopover({ caseName, cancels, onClose }: {
  caseName: string; cancels: CaseCancelSummary; onClose: () => void;
}) {
  const entities = [cancels.family, ...cancels.bts, cancels.adminBcba];
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))', boxSizing: 'border-box',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: 8, maxWidth: 560, width: '100%', maxHeight: '100%',
        overflow: 'auto', padding: 16, boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Cancellations — {caseName}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb', color: '#374151' }}>
              <th style={{ padding: '4px 8px' }}>Who</th>
              {CANCEL_WINDOWS.map(w => (
                <th key={w} style={{ padding: '4px 8px', textAlign: 'center' }}>{CANCEL_WINDOW_LABELS[w]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entities.map(e => (
              <tr key={e.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {labelFor(e)}
                </td>
                {CANCEL_WINDOWS.map(w => (
                  <td key={w} style={{ padding: '4px 8px', textAlign: 'center', color: cancelSeverityColor(e.totals[w]) }}>
                    <div style={{ fontWeight: 600 }}>{e.totals[w]}</div>
                    <TypeBreakdown byType={e.byType[w]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
          60d / 30d are rolling windows; Mo / Wk are this calendar month / week to date.
          Direct &amp; supervision use a 30-day reset; parent-training &amp; case-planning use 60.
        </p>
      </div>
    </div>
  );
}

function TypeBreakdown({ byType }: { byType: Partial<Record<Appointment['type'], number>> }) {
  const entries = Object.entries(byType) as [Appointment['type'], number][];
  if (entries.length === 0) return null;
  return (
    <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.3 }}>
      {entries.map(([t, n]) => `${cancelTypeAbbr(t)} ${n}`).join(' ')}
    </div>
  );
}

function labelFor(e: EntityCancels): string {
  if (e.kind === 'family') return 'Family (F)';
  if (e.kind === 'adminBcba') return 'Admin / BCBA';
  return `BT ${e.label}`;
}

function chip(color: string): CSSProperties {
  return {
    display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 10, color: 'white', background: color, whiteSpace: 'nowrap',
  };
}

// Factor detail lines are prefixed with the case name ("Alex: supervision …").
// The row already shows the name, so drop the redundant prefix.
function stripSubject(detail: string, name: string): string {
  return detail.startsWith(`${name}: `) ? detail.slice(name.length + 2) : detail;
}
