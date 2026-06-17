import React, { useEffect } from 'react';
import type { CprAnalysis, AntecedentResult, ConsequenceResult, LagResult } from '../cpr/types';

interface Props {
  analysis: CprAnalysis;
  onBack: () => void;
}

const PCT = (v: number) => `${(v * 100).toFixed(1)}%`;
const FMT = (v: number, d = 2) => v.toFixed(d);
const fmtMs = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};
const sigMark = (z: number) =>
  Math.abs(z) >= 2.58 ? '**' : Math.abs(z) >= 1.96 ? '*' : '';

const TH: React.CSSProperties = {
  padding: '7px 10px', textAlign: 'left', fontSize: 11,
  fontWeight: 700, color: '#374151', background: '#f9fafb',
  borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
};
const THR: React.CSSProperties = { ...TH, textAlign: 'right' };
const TD: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #f3f4f6', color: '#111827' };
const TDR: React.CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const TDG: React.CSSProperties = { ...TDR, color: '#059669', fontWeight: 700 };
const SECTION_HEAD: React.CSSProperties = {
  fontSize: 13, fontWeight: 800, color: '#1e293b',
  borderBottom: '2px solid #1e293b', paddingBottom: 4, marginBottom: 12,
  letterSpacing: 0.5, textTransform: 'uppercase' as const,
};

function SigLegend() {
  return (
    <p style={{ fontSize: 10, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>
      * p &lt; .05 &nbsp;|&nbsp; ** p &lt; .01 &nbsp;|&nbsp; Yule's Q: |Q| &ge; 0.5 = strong association
    </p>
  );
}

function AntecedentTable({ rows }: { rows: AntecedentResult[] }) {
  if (rows.length === 0) return <p style={{ fontSize: 12, color: '#9ca3af' }}>No antecedent codes recorded.</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Antecedent</th>
          <th style={THR}>n(A)</th>
          <th style={THR}>P(A|B)</th>
          <th style={THR}>P(A) base</th>
          <th style={THR}>P(B|A)</th>
          <th style={THR}>Yule's Q</th>
          <th style={THR}>z-score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.antecedentId} style={{ background: r.significant ? '#f0fdf4' : undefined }}>
            <td style={TD}>{r.antecedentLabel}</td>
            <td style={TDR}>{r.nA}</td>
            <td style={r.significant ? TDG : TDR}>{PCT(r.pAgivenB)}{sigMark(r.z)}</td>
            <td style={TDR}>{PCT(r.pAuncond)}</td>
            <td style={TDR}>{PCT(r.pBgivenA)}</td>
            <td style={TDR}>{FMT(r.yulesQ)}</td>
            <td style={TDR}>{FMT(r.z)}{sigMark(r.z)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsequenceTable({ rows }: { rows: ConsequenceResult[] }) {
  if (rows.length === 0) return <p style={{ fontSize: 12, color: '#9ca3af' }}>No consequence codes recorded.</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Consequence</th>
          <th style={THR}>n(B)</th>
          <th style={THR}>P(C|B)</th>
          <th style={THR}>P(C) base</th>
          <th style={THR}>Yule's Q</th>
          <th style={THR}>z-score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.consequenceId} style={{ background: r.significant ? '#f0fdf4' : undefined }}>
            <td style={TD}>{r.consequenceLabel}</td>
            <td style={TDR}>{r.nB}</td>
            <td style={r.significant ? TDG : TDR}>{PCT(r.pCgivenB)}{sigMark(r.z)}</td>
            <td style={TDR}>{PCT(r.pCuncond)}</td>
            <td style={TDR}>{FMT(r.yulesQ)}</td>
            <td style={TDR}>{FMT(r.z)}{sigMark(r.z)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LagBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 10, background: '#f3f4f6', borderRadius: 5, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${w}%`, background: color,
          borderRadius: 5, transition: 'width 0.3s',
          minWidth: value > 0 ? 2 : 0,
        }} />
      </div>
      <span style={{ fontSize: 10, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#374151' }}>
        {PCT(value)}
      </span>
    </div>
  );
}

function LagSection({ lagResults, lagWindowMs, lagCount }: {
  lagResults: LagResult[];
  lagWindowMs: number;
  lagCount: number;
}) {
  const winSec = lagWindowMs / 1000;
  const topResults = lagResults.filter(r => r.maxAbsZ >= 1.5).slice(0, 8);
  if (topResults.length === 0) {
    return <p style={{ fontSize: 12, color: '#9ca3af' }}>No significant lag associations detected.</p>;
  }
  const maxP = Math.max(...topResults.flatMap(r => r.lagPoints.map(p => p.pConditional)), 0.01);

  return (
    <>
      {/* Lag profile chart */}
      {topResults.map(lr => (
        <div key={lr.codeId} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: lr.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
              {lr.codeLabel} ({lr.codeAbbr})
            </span>
            {lr.maxAbsZ >= 1.96 && (
              <span style={{ fontSize: 10, background: '#d1fae5', color: '#065f46', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                significant
              </span>
            )}
          </div>
          <div style={{ paddingLeft: 16 }}>
            {lr.lagPoints.map(lp => (
              <div key={lp.lag} style={{ display: 'grid', gridTemplateColumns: '60px 1fr', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: '#6b7280' }}>Lag {lp.lag} ({lp.windowLabel})</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <LagBar value={lp.pConditional} max={maxP} color={lp.significant ? lr.color : lr.color + '55'} />
                  {lp.significant && (
                    <span style={{ fontSize: 9, color: '#059669', fontWeight: 700, minWidth: 12 }}>*</span>
                  )}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>
              Base rate: {PCT(lr.lagPoints[0]?.pUncond ?? 0)} &nbsp;|&nbsp;
              Max |z| = {lr.maxAbsZ.toFixed(2)}
            </div>
          </div>
        </div>
      ))}

      {/* Lag table */}
      <div style={{ marginTop: 16, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={TH}>Code</th>
              <th style={THR}>Base rate P</th>
              {Array.from({ length: lagCount }, (_, i) => (
                <th key={i} style={THR}>Lag {i + 1}<br /><span style={{ fontWeight: 400, fontSize: 9 }}>{i * winSec}–{(i + 1) * winSec}s</span></th>
              ))}
              <th style={THR}>Max |z|</th>
            </tr>
          </thead>
          <tbody>
            {topResults.map(lr => (
              <tr key={lr.codeId}>
                <td style={TD}>{lr.codeLabel}</td>
                <td style={TDR}>{PCT(lr.lagPoints[0]?.pUncond ?? 0)}</td>
                {lr.lagPoints.map(lp => (
                  <td key={lp.lag} style={lp.significant ? TDG : TDR}>
                    {PCT(lp.pConditional)}{sigMark(lp.z)}
                  </td>
                ))}
                <td style={TDR}>{lr.maxAbsZ.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SigLegend />
    </>
  );
}

export default function CprReport({ analysis, onBack }: Props) {
  const { session, eventFreq, antecedentResults, consequenceResults,
          lagResults, functionSummaries, behaviorCount, behaviorRatePerHour,
          totalIntervals } = analysis;

  const targetBehavior = session.codeSetSnapshot.codes.find(
    c => c.id === session.targetBehaviorId
  );

  // Inject print CSS
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'cpr-print-css';
    style.textContent = `
      @media print {
        @page { margin: 18mm 16mm; size: A4; }
        body > * { display: none !important; }
        #cpr-print-target { display: block !important; }
        .cpr-no-print { display: none !important; }
        .cpr-page-break { page-break-before: always; }
        table { page-break-inside: avoid; }
        tr { page-break-inside: avoid; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById('cpr-print-css')?.remove(); };
  }, []);

  const winSec = session.lagWindowMs / 1000;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f8fafc', padding: '16px 0' }}>
      {/* Toolbar — hidden in print */}
      <div className="cpr-no-print" style={{
        display: 'flex', gap: 10, padding: '0 20px', marginBottom: 16,
      }}>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db',
            background: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600,
          }}
        >← Sessions</button>
        <button
          onClick={() => window.print()}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: '#1e293b', color: '#fff', fontSize: 14, cursor: 'pointer',
            fontWeight: 700,
          }}
        >Print / Export PDF</button>
        <span style={{ fontSize: 12, color: '#9ca3af', alignSelf: 'center' }}>
          Use "Save as PDF" in the print dialog
        </span>
      </div>

      {/* Report body */}
      <div
        id="cpr-print-target"
        style={{
          maxWidth: 800, margin: '0 auto', padding: '24px 28px',
          background: '#fff', borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Report header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', letterSpacing: 1.5, marginBottom: 4 }}>
            APPLIED BEHAVIOR ANALYSIS
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0, lineHeight: 1.2 }}>
            Conditional Probability Analysis Report
          </h1>
          <div style={{ height: 3, background: 'linear-gradient(to right, #6366f1, #10b981)', borderRadius: 2, marginTop: 8, marginBottom: 16 }} />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px 24px',
            padding: '12px 16px', background: '#f8fafc', borderRadius: 8,
            border: '1px solid #e5e7eb',
          }}>
            {[
              ['Client', session.clientLabel],
              ['Observer', session.observerName],
              ['Date', session.date],
              ['Duration', fmtMs(session.durationMs)],
              ['Criterion behavior', targetBehavior?.label ?? session.targetBehaviorId],
              ['Code set', session.codeSetSnapshot.name],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{v}</div>
              </div>
            ))}
          </div>
          {session.notes && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', borderRadius: 6, fontSize: 12, color: '#374151', borderLeft: '3px solid #f59e0b' }}>
              <strong>Notes:</strong> {session.notes}
            </div>
          )}
        </div>

        {/* Session summary */}
        <div style={{ marginBottom: 24 }}>
          <div style={SECTION_HEAD}>Session Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              ['Total events', String(session.events.length)],
              [`${targetBehavior?.abbr ?? 'Behavior'} occurrences`, String(behaviorCount)],
              ['Rate / hour', `${behaviorRatePerHour.toFixed(1)}`],
              ['Observation window', `${winSec}s`],
            ].map(([k, v]) => (
              <div key={k} style={{
                textAlign: 'center', padding: '10px 8px',
                background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb',
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>{v}</div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{k}</div>
              </div>
            ))}
          </div>
          {behaviorCount < 10 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '6px 10px' }}>
              Note: Fewer than 10 criterion event occurrences (n = {behaviorCount}). Statistical results should be interpreted cautiously. A minimum of 10–20 occurrences is recommended for reliable conditional probability estimates.
            </div>
          )}
        </div>

        {/* Event frequency */}
        <div style={{ marginBottom: 24 }}>
          <div style={SECTION_HEAD}>Event Frequency</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Code</th>
                <th style={TH}>Category</th>
                <th style={THR}>Count</th>
                <th style={THR}>% of events</th>
                <th style={THR}>Rate / hr</th>
              </tr>
            </thead>
            <tbody>
              {eventFreq.map(row => (
                <tr key={row.codeId}>
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                      <strong>{row.abbr}</strong> — {row.label}
                    </div>
                  </td>
                  <td style={TD} >
                    <span style={{ fontSize: 10, background: row.category === 'antecedent' ? '#fef3c7' : row.category === 'behavior' ? '#fee2e2' : '#d1fae5', color: row.category === 'antecedent' ? '#92400e' : row.category === 'behavior' ? '#991b1b' : '#065f46', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                      {row.category[0].toUpperCase() + row.category.slice(1)}
                    </span>
                  </td>
                  <td style={TDR}>{row.count}</td>
                  <td style={TDR}>{PCT(row.pct)}</td>
                  <td style={TDR}>{row.ratePerHour.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Antecedent analysis */}
        <div style={{ marginBottom: 24 }}>
          <div style={SECTION_HEAD}>Antecedent Analysis</div>
          <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 10, lineHeight: 1.5 }}>
            P(A|B) = proportion of {targetBehavior?.label ?? 'target behavior'} occurrences preceded by antecedent A within the {winSec}s observation window.
            Compared to the unconditional base rate P(A) using the Bakeman &amp; Gottman (1997) z-test.
            Yule's Q measures the strength of the association (−1 to +1).
          </p>
          <AntecedentTable rows={antecedentResults} />
          <SigLegend />
        </div>

        {/* Consequence analysis */}
        <div className="cpr-page-break" style={{ marginBottom: 24 }}>
          <div style={SECTION_HEAD}>Consequence Analysis</div>
          <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 10, lineHeight: 1.5 }}>
            P(C|B) = proportion of {targetBehavior?.label ?? 'target behavior'} occurrences followed by consequence C within the {winSec}s observation window (Vollmer et al., 1993).
            Elevated P(C|B) relative to the base rate P(C) is consistent with C functioning as a reinforcer for the target behavior.
          </p>
          <ConsequenceTable rows={consequenceResults} />
          <SigLegend />
        </div>

        {/* Lag sequential analysis */}
        {lagResults && (
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_HEAD}>Lag Sequential Analysis</div>
            <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 10, lineHeight: 1.5 }}>
              Probability of each event occurring at successive {winSec}s windows following {targetBehavior?.label ?? 'target behavior'} occurrence
              (Sackett, 1979; Bakeman &amp; Gottman, 1997). Elevated probabilities at early lags relative to base rate
              suggest temporal dependency. z-scores computed relative to unconditional P(event).
            </p>
            <LagSection lagResults={lagResults} lagWindowMs={session.lagWindowMs} lagCount={session.lagCount} />
          </div>
        )}

        {/* Functional hypothesis */}
        <div className="cpr-page-break" style={{ marginBottom: 24 }}>
          <div style={SECTION_HEAD}>Functional Hypothesis Summary</div>
          <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 14, lineHeight: 1.5 }}>
            The following functional hypotheses are derived from the conditional probability patterns above.
            Conclusions are descriptive, not experimental. Formal functional analysis (Iwata et al., 1994) is recommended
            to confirm function prior to intervention design.
          </p>
          {functionSummaries.map(fs => (
            <div key={fs.hypothesis} style={{
              marginBottom: 12, padding: '12px 14px', borderRadius: 8,
              background: fs.supported ? '#f0fdf4' : '#fafafa',
              border: `1px solid ${fs.supported ? '#86efac' : '#e5e7eb'}`,
              borderLeft: `4px solid ${fs.supported ? '#10b981' : '#d1d5db'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: fs.supported ? '#10b981' : '#9ca3af', color: '#fff',
                }}>
                  {fs.supported ? 'SUPPORTED' : 'NOT SUPPORTED'}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{fs.label}</span>
              </div>
              <p style={{ fontSize: 12, color: '#374151', margin: 0, lineHeight: 1.5 }}>{fs.evidence}</p>
            </div>
          ))}
        </div>

        {/* References */}
        <div style={{ marginBottom: 12 }}>
          <div style={SECTION_HEAD}>References</div>
          <ul style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
            <li>Bakeman, R., &amp; Gottman, J.M. (1997). <em>Observing Interaction: An Introduction to Sequential Analysis</em> (2nd ed.). Cambridge University Press.</li>
            <li>Iwata, B.A., Dorsey, M.F., Slifer, K.J., Bauman, K.E., &amp; Richman, G.S. (1994). Toward a functional analysis of self-injury. <em>Journal of Applied Behavior Analysis, 27</em>(2), 197–209.</li>
            <li>Sackett, G.P. (1979). The lag sequential analysis of contingency and cyclicity in behavioral interaction research. In J.D. Osofsky (Ed.), <em>Handbook of infant development</em>. Wiley.</li>
            <li>Vollmer, T.R., Iwata, B.A., Zarcone, J.R., Smith, R.G., &amp; Mazaleski, J.L. (1993). The role of attention in the treatment of attention-maintained self-injurious behavior. <em>Journal of Applied Behavior Analysis, 26</em>(2), 269–278.</li>
          </ul>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af' }}>
            <span>Generated {new Date(session.createdAt).toLocaleString()}</span>
            <span>Conditional Probability Recording · SAssi Cal</span>
          </div>
          <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' }}>
            This report is a descriptive analysis of naturalistic observation data. It does not constitute a diagnosis or prescribe treatment.
            Clinical interpretation by a Board Certified Behavior Analyst (BCBA) is required.
          </p>
        </div>
      </div>
    </div>
  );
}
