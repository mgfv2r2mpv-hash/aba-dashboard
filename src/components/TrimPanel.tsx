import React, { useState, useMemo } from 'react';
import { ScheduleData, WishSolution, WishOp } from '../types';
import { computeClientCompliance, monthPeriod } from '../compliance';
import { v4 as uuidv4 } from 'uuid';

// "Trim This Down" panel. After an AI solution is generated, the BCBA may want
// to keep only a subset of the proposed adds — e.g. if the solution overshoots
// the billable goal. Cases are ranked by compliance gap (most behind = top);
// the user can reorder by clinical priority and uncheck sessions to drop.

interface Props {
  solution: WishSolution;
  data: ScheduleData;
  onApply: (trimmed: WishSolution) => void;
  onClose: () => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function sessionHours(op: Extract<WishOp, { op: 'add' }>): number {
  return (new Date(op.end).getTime() - new Date(op.start).getTime()) / 3_600_000;
}

export default function TrimPanel({ solution, data, onApply, onClose }: Props) {
  // Group adds by resolved client name/id
  const addOps = solution.ops.filter((o): o is Extract<WishOp, { op: 'add' }> => o.op === 'add');

  // Compliance priority: most hours-to-go first
  const now = new Date();
  const period = monthPeriod(now);
  const complianceMap = useMemo(() => {
    const rows = computeClientCompliance(data, period, now);
    return new Map(rows.map(r => [r.client.id, r.projected.hoursToGo]));
  }, [data]);

  // Unique clients in the solution (in compliance-gap order)
  const solutionClients = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; hoursToGo: number }>();
    for (const op of addOps) {
      if (!op.client) continue;
      if (seen.has(op.client)) continue;
      const c = data.clients.find(cl => cl.id === op.client);
      const id = c?.id || op.client;
      const name = c?.name || op.client;
      seen.set(op.client, { id, name, hoursToGo: complianceMap.get(id) ?? 0 });
    }
    return [...seen.values()].sort((a, b) => b.hoursToGo - a.hoursToGo);
  }, [addOps, data, complianceMap]);

  // Checked state: all ops checked by default
  const [checked, setChecked] = useState<Set<number>>(() => new Set(addOps.map((_, i) => i)));

  const toggleOp = (idx: number) => setChecked(s => {
    const next = new Set(s);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  const toggleClient = (clientRef: string) => {
    const clientIdxs = addOps
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.client === clientRef)
      .map(({ i }) => i);
    const allChecked = clientIdxs.every(i => checked.has(i));
    setChecked(s => {
      const next = new Set(s);
      if (allChecked) clientIdxs.forEach(i => next.delete(i));
      else clientIdxs.forEach(i => next.add(i));
      return next;
    });
  };

  const selectedHours = addOps.reduce((sum, op, i) => checked.has(i) ? sum + sessionHours(op) : sum, 0);
  const totalHours = addOps.reduce((sum, op) => sum + sessionHours(op), 0);

  const apply = () => {
    const keptOps = solution.ops.filter((o, i) => {
      if (o.op !== 'add') return true; // keep all non-add ops
      const addIdx = addOps.indexOf(o as Extract<WishOp, { op: 'add' }>);
      return checked.has(addIdx);
    });
    onApply({
      ...solution,
      id: uuidv4(),
      summary: `${solution.summary} (trimmed)`,
      ops: keptOps,
    });
  };

  const noAdds = addOps.length === 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: 'white', borderRadius: '12px 12px 0 0', width: '100%', maxWidth: 560,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>✂️ Trim This Down</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>
              Cases ranked by compliance gap. Uncheck sessions you want to drop.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', padding: '0 4px' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 16px' }}>
          {noAdds && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>This solution has no add operations to trim.</p>
          )}
          {solutionClients.map(client => {
            const clientAddIdxs = addOps
              .map((o, i) => ({ o, i }))
              .filter(({ o }) => o.client === client.id || o.client === client.name);
            const allChecked = clientAddIdxs.every(({ i }) => checked.has(i));
            const someChecked = clientAddIdxs.some(({ i }) => checked.has(i));
            return (
              <div key={client.id} style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={() => toggleClient(client.id || client.name)}
                    style={{ width: 15, height: 15 }}
                  />
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{client.name}</span>
                  {client.hoursToGo > 0 && (
                    <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                      −{client.hoursToGo.toFixed(1)}h to compliance
                    </span>
                  )}
                </label>
                <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {clientAddIdxs.map(({ o, i }) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={checked.has(i)}
                        onChange={() => toggleOp(i)}
                      />
                      <span style={{ color: checked.has(i) ? '#374151' : '#9ca3af', textDecoration: checked.has(i) ? 'none' : 'line-through' }}>
                        {o.title || o.type} {fmtTime(o.start)}–{fmtTime(o.end)}
                        <span style={{ color: '#6b7280', marginLeft: 4 }}>({sessionHours(o).toFixed(1)}h)</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Non-add ops that can't be trimmed */}
          {solution.ops.some(o => o.op !== 'add') && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, padding: '6px 0', borderTop: '1px solid #f3f4f6' }}>
              {solution.ops.filter(o => o.op !== 'add').length} move/remove/blackout op(s) kept as-is.
            </div>
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 13, color: '#374151' }}>
              <strong>{selectedHours.toFixed(1)}h</strong> of {totalHours.toFixed(1)}h selected
              <span style={{ color: '#6b7280', marginLeft: 6 }}>({checked.size}/{addOps.length} sessions)</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 14px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button
                onClick={apply}
                disabled={checked.size === 0}
                style={{ padding: '7px 14px', background: checked.size === 0 ? '#fdba74' : '#ea580c', color: 'white', border: 'none', borderRadius: 6, cursor: checked.size === 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}
              >Apply trimmed version</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
