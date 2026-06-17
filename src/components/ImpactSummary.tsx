import React from 'react';
import type { SolutionImpact } from '../wish';

function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }
function fmtDelta(n: number): string { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`; }
function fmt1(n: number): string { return n.toFixed(1); }

// Compact compliance-impact summary for a single solution card.
// Shows projected before→after supervision % and hours for every affected
// client and tech, plus net session count. Used in both FixItPanel and
// WishComposer so the BCBA can compare options on real numbers, not just
// the AI's prose reasoning.
export default function ImpactSummary({ impact }: { impact: SolutionImpact }) {
  const { clientImpacts, techImpacts, sessionsAdded, sessionsRemoved } = impact;
  const hasClients  = clientImpacts.length > 0;
  const hasTechs    = techImpacts.length > 0;
  const hasSessions = sessionsAdded > 0 || sessionsRemoved > 0;

  return (
    <div style={{
      marginTop: 8,
      borderTop: '1px solid #e5e7eb',
      paddingTop: 8,
      fontSize: 12,
    }}>
      <div style={{
        fontWeight: 600, color: '#6b7280', marginBottom: 5,
        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        Impact preview — current month (projected)
      </div>

      {!hasClients && !hasTechs && !hasSessions && (
        <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>
          No supervision change within the current calendar month
        </div>
      )}

      {hasClients && (
        <div style={{ marginBottom: hasTechs || hasSessions ? 6 : 0 }}>
          <div style={{ fontWeight: 600, color: '#374151', marginBottom: 3 }}>Client supervision</div>
          {clientImpacts.map(ci => (
            <div
              key={ci.client.id}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 6px', padding: '2px 0', lineHeight: 1.5 }}
            >
              <span style={{ color: '#111827', minWidth: 110 }}>{ci.client.name}</span>
              <span style={{ color: '#6b7280' }}>{fmtPct(ci.beforePct)}</span>
              <span style={{ color: '#9ca3af' }}>→</span>
              <span style={{ color: '#111827', fontWeight: 600 }}>{fmtPct(ci.afterPct)}</span>
              <span style={{ color: ci.deltaPct >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                ({fmtDelta(ci.deltaPct)}pp)
              </span>
              <span style={{ color: ci.deltaPct >= 0 ? '#15803d' : '#b91c1c' }}>
                {fmtDelta(ci.deltaSupHours)}h sup
              </span>
              {ci.hoursToGoAfter > 0.05
                ? <span style={{ color: '#b45309' }}>· {fmt1(ci.hoursToGoAfter)}h still needed</span>
                : <span style={{ color: '#15803d' }}>· compliant ✓</span>
              }
            </div>
          ))}
        </div>
      )}

      {hasTechs && (
        <div style={{ marginBottom: hasSessions ? 6 : 0 }}>
          <div style={{ fontWeight: 600, color: '#374151', marginBottom: 3 }}>BT supervision</div>
          {techImpacts.map(ti => (
            <div
              key={ti.tech.id}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 6px', padding: '2px 0', lineHeight: 1.5 }}
            >
              <span style={{ color: '#111827', minWidth: 110 }}>{ti.tech.name}</span>
              <span style={{ color: '#6b7280' }}>{fmtPct(ti.beforePct)}</span>
              <span style={{ color: '#9ca3af' }}>→</span>
              <span style={{ color: '#111827', fontWeight: 600 }}>{fmtPct(ti.afterPct)}</span>
              <span style={{ color: ti.deltaPct >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                ({fmtDelta(ti.deltaPct)}pp)
              </span>
              {ti.hoursToGoAfter > 0.05
                ? <span style={{ color: '#b45309' }}>· {fmt1(ti.hoursToGoAfter)}h still needed</span>
                : <span style={{ color: '#15803d' }}>· compliant ✓</span>
              }
            </div>
          ))}
        </div>
      )}

      {hasSessions && (
        <div style={{ color: '#6b7280' }}>
          {sessionsAdded > 0 && `+${sessionsAdded} session${sessionsAdded !== 1 ? 's' : ''} added`}
          {sessionsAdded > 0 && sessionsRemoved > 0 && ' · '}
          {sessionsRemoved > 0 && `${sessionsRemoved} session${sessionsRemoved !== 1 ? 's' : ''} removed`}
        </div>
      )}
    </div>
  );
}
