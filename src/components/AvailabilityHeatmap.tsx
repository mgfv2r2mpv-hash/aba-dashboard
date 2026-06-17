// Availability & Schedule heatmap for the Case Week view.
//
// One row per client (clustered so clients with overlapping availability sit
// next to each other). Each row is a 7-day strip of proportional, real-minute
// timelines — no 30-minute snapping, so windows like 10:45a–12:45p land exactly.
//
// Within every day the cell layers back→front, matching the z-axis model:
//   availability (backmost translucent band)
//     → scheduled direct      (client work)
//       → scheduled supervision
//         → parent training    (foremost)
// Higher tiers are inset so the stack is readable at a glance.
//
// The client's initials and the actual window start/end times are printed as
// text in the row label, so the schedule is legible without reading colors.

import React, { useMemo } from 'react';
import { Client, Appointment } from '../types';
import { clientHue } from '../calendarColors';
import { format, isSameDay } from 'date-fns';
import {
  DAY_S, DAY_E, WEEK_DAYS, SHORT_DAYS, toMin, fmtMin,
  SessionTier, tierOf, TIER_COLOR, TIER_LABEL,
} from './clientCalendarShared';

const LABEL_W = 138;
const DAY_W   = 118;
const DAY_GAP = 5;
const META_W  = 82;
const ROW_H   = 38;
const TRACK_H = 22;

const SPAN_MIN = (DAY_E - DAY_S) * 60;
const BASE_MIN = DAY_S * 60;

// Inset + z per tier so layering reads as depth.
const TIER_LAYOUT: Record<SessionTier, { inset: number; z: number }> = {
  direct:         { inset: 2, z: 2 },
  other:          { inset: 4, z: 3 },
  supervision:    { inset: 5, z: 4 },
  parentTraining: { inset: 8, z: 5 },
};

interface HeatmapProps {
  days: Date[];
  clients: Client[];
  appointments: Appointment[];
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
}

interface Bar { leftPct: number; widthPct: number; startMin: number; endMin: number; }
interface DayCell { avail: Bar[]; sessions: { tier: SessionTier; bar: Bar; title: string }[]; }
interface Row {
  client: Client;
  hue: number;
  windowsText: string;
  cells: DayCell[];
  utilPct: number;
  bookedHrs: number;
  availHrs: number;
}

const apptMin = (iso: string): number => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const pct = (a: number, b: number) => Math.max(0, Math.min(100, ((b - a) / SPAN_MIN) * 100));
const leftOf = (m: number) => Math.max(0, Math.min(100, ((m - BASE_MIN) / SPAN_MIN) * 100));

function buildRow(client: Client, days: Date[], appointments: Appointment[]): Row {
  const hue = clientHue(client.name);

  // Distinct weekly windows → text ("10:45a–12:45p · 5p–7p").
  const seen = new Set<string>();
  const distinct: { s: number; e: number }[] = [];
  WEEK_DAYS.forEach(dow => {
    (client.availabilityWindows[dow] ?? []).forEach(w => {
      const key = `${w.start}-${w.end}`;
      if (!seen.has(key)) { seen.add(key); distinct.push({ s: toMin(w.start), e: toMin(w.end) }); }
    });
  });
  distinct.sort((a, b) => a.s - b.s);
  const windowsText = distinct.length
    ? distinct.map(w => `${fmtMin(w.s)}–${fmtMin(w.e)}`).join(' · ')
    : 'no availability set';

  let availMin = 0, bookedMin = 0;
  const cells: DayCell[] = days.map((day, di) => {
    const dow  = WEEK_DAYS[di];
    const iso  = format(day, 'yyyy-MM-dd');
    const wins = client.availabilityWindows[dow] ?? [];
    const appts = appointments.filter(a =>
      a.startTime.startsWith(iso) && (a.client === client.id || a.client === client.name),
    );

    const avail: Bar[] = wins.map(w => {
      const s = toMin(w.start), e = toMin(w.end);
      return { leftPct: leftOf(s), widthPct: pct(s, e), startMin: s, endMin: e };
    });

    const sessions = appts.map(a => {
      const s = apptMin(a.startTime), e = apptMin(a.endTime);
      const tier = tierOf(a.type);
      return {
        tier,
        bar: { leftPct: leftOf(s), widthPct: pct(s, e), startMin: s, endMin: e },
        title: `${SHORT_DAYS[di]} ${fmtMin(s)}–${fmtMin(e)} · ${TIER_LABEL[tier]}${a.technician ? ` · ${a.technician}` : ''}`,
      };
    });

    // Minute-resolution utilization: how much availability is booked.
    if (wins.length) {
      const availArr = new Uint8Array(SPAN_MIN);
      wins.forEach(w => {
        for (let m = Math.max(BASE_MIN, toMin(w.start)); m < Math.min(BASE_MIN + SPAN_MIN, toMin(w.end)); m++) availArr[m - BASE_MIN] = 1;
      });
      const bookArr = new Uint8Array(SPAN_MIN);
      appts.forEach(a => {
        const s = apptMin(a.startTime), e = apptMin(a.endTime);
        for (let m = Math.max(BASE_MIN, s); m < Math.min(BASE_MIN + SPAN_MIN, e); m++) bookArr[m - BASE_MIN] = 1;
      });
      for (let i = 0; i < SPAN_MIN; i++) { if (availArr[i]) { availMin++; if (bookArr[i]) bookedMin++; } }
    }

    return { avail, sessions };
  });

  const utilPct = availMin > 0 ? Math.round((100 * bookedMin) / availMin) : 0;
  return {
    client, hue, windowsText, cells, utilPct,
    bookedHrs: +(bookedMin / 60).toFixed(1),
    availHrs: +(availMin / 60).toFixed(1),
  };
}

export default function AvailabilityHeatmap({ days, clients, appointments, highlightId, onHighlight }: HeatmapProps) {
  const ordered = useMemo(() => clusterByOverlap(clients), [clients]);
  const rows = useMemo(() => ordered.map(c => buildRow(c, days, appointments)), [ordered, days, appointments]);

  const stripW = days.length * DAY_W + (days.length - 1) * DAY_GAP;
  const totalW = LABEL_W + stripW + META_W;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
      {/* Header + legend */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #f0f0f0',
        background: 'linear-gradient(90deg,#f8fafc,#f1f5f9)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Availability &amp; Schedule
        </span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>clustered by overlap · click a row to focus</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <LegendSwatch kind="avail" label="Available" />
          <LegendSwatch kind="direct" label={TIER_LABEL.direct} />
          <LegendSwatch kind="supervision" label={TIER_LABEL.supervision} />
          <LegendSwatch kind="parentTraining" label={TIER_LABEL.parentTraining} />
        </div>
      </div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: totalW }}>

          {/* Day header */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, fontSize: 9, color: '#94a3b8', padding: '4px 8px', display: 'flex', alignItems: 'flex-end', fontWeight: 700 }}>Client · windows</div>
            <div style={{ display: 'flex', gap: DAY_GAP }}>
              {days.map((day, di) => {
                const isToday = isSameDay(day, new Date());
                return (
                  <div key={di} style={{
                    width: DAY_W, flexShrink: 0, textAlign: 'center', padding: '4px 0 3px',
                    fontSize: 10, fontWeight: 700, color: isToday ? '#3b82f6' : '#475569',
                    background: isToday ? '#eff6ff' : 'transparent',
                  }}>
                    {SHORT_DAYS[di]} {format(day, 'd')}
                  </div>
                );
              })}
            </div>
            <div style={{ width: META_W, flexShrink: 0, fontSize: 9, color: '#94a3b8', padding: '4px 8px', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', fontWeight: 700 }}>Util</div>
          </div>

          {/* Rows */}
          {rows.map(row => (
            <HeatmapRow key={row.client.id} row={row}
              focused={highlightId === row.client.id}
              dimmed={highlightId !== null && highlightId !== row.client.id}
              onClick={() => onHighlight(highlightId === row.client.id ? null : row.client.id)} />
          ))}

          {rows.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No clients selected.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeatmapRow({ row, focused, dimmed, onClick }: { row: Row; focused: boolean; dimmed: boolean; onClick: () => void }) {
  const { client, hue, windowsText, cells, utilPct, bookedHrs, availHrs } = row;
  const utilColor = utilPct >= 70 ? '#059669' : utilPct >= 40 ? '#d97706' : '#94a3b8';
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #f1f5f9',
      cursor: 'pointer', background: focused ? `hsl(${hue} 70% 97%)` : 'white',
      opacity: dimmed ? 0.4 : 1, transition: 'opacity 0.15s, background 0.15s',
    }}>
      {/* Label: initials + real window times */}
      <div style={{ width: LABEL_W, flexShrink: 0, padding: '5px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: `hsl(${hue} 65% 48%)`, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: `hsl(${hue} 40% 26%)` }}>{client.name}</span>
        </span>
        <span style={{ fontSize: 9.5, color: '#64748b', lineHeight: 1.25, whiteSpace: 'normal' }}>{windowsText}</span>
      </div>

      {/* 7-day strip */}
      <div style={{ display: 'flex', gap: DAY_GAP, alignItems: 'center' }}>
        {cells.map((cell, di) => (
          <div key={di} style={{ width: DAY_W, height: ROW_H, position: 'relative', flexShrink: 0 }}>
            {/* hour ticks (every 4h) */}
            {[0, 4, 8, 12, 16].map(hOff => {
              const hr = DAY_S + hOff;
              if (hr > DAY_E) return null;
              return <div key={hOff} style={{ position: 'absolute', top: 3, bottom: 3, left: `${leftOf(hr * 60)}%`, width: 1, background: '#f1f5f9' }} />;
            })}
            {/* track */}
            <div style={{ position: 'absolute', top: (ROW_H - TRACK_H) / 2, left: 2, right: 2, height: TRACK_H }}>
              {/* availability (back) */}
              {cell.avail.map((b, i) => (
                <div key={`a${i}`} title={`${fmtMin(b.startMin)}–${fmtMin(b.endMin)} available`}
                  style={{
                    position: 'absolute', top: 0, height: TRACK_H,
                    left: `${b.leftPct}%`, width: `${b.widthPct}%`,
                    background: `hsl(${hue} 70% 88%)`, border: `1px solid hsl(${hue} 48% 76%)`,
                    borderRadius: 3, zIndex: 1,
                  }} />
              ))}
              {/* sessions layered by tier */}
              {cell.sessions.map((s, i) => {
                const { inset, z } = TIER_LAYOUT[s.tier];
                const h = TRACK_H - inset * 2;
                const color = s.tier === 'direct' ? `hsl(${hue} 72% 48%)` : TIER_COLOR[s.tier];
                return (
                  <div key={`s${i}`} title={s.title}
                    style={{
                      position: 'absolute', top: inset, height: h,
                      left: `${s.bar.leftPct}%`, width: `${s.bar.widthPct}%`,
                      minWidth: 2, background: color, borderRadius: 2, zIndex: z,
                      boxShadow: '0 0 0 1px rgba(255,255,255,0.55)',
                    }} />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Utilization */}
      <div style={{ width: META_W, flexShrink: 0, padding: '0 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontWeight: 800, color: utilColor, fontSize: 13 }}>{utilPct}%</div>
        <div style={{ height: 5, borderRadius: 3, background: '#e2e8f0', marginTop: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(100, utilPct)}%`, background: utilColor }} />
        </div>
        <div style={{ marginTop: 2, color: '#94a3b8', fontSize: 9.5 }}>{bookedHrs}h / {availHrs}h</div>
      </div>
    </div>
  );
}

function LegendSwatch({ kind, label }: { kind: 'avail' | SessionTier; label: string }) {
  const bg = kind === 'avail' ? 'hsl(210 70% 86%)'
    : kind === 'direct' ? 'hsl(265 60% 55%)'
    : TIER_COLOR[kind as SessionTier];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
      <span style={{ width: 11, height: 11, borderRadius: 2, background: bg, border: kind === 'avail' ? '1px solid hsl(210 48% 74%)' : 'none' }} />
      {label}
    </span>
  );
}

// ── Overlap clustering ──────────────────────────────────────────────────────
// Greedy nearest-neighbour ordering on each client's weekly availability vector
// (30-min resolution is plenty for similarity), so clients whose windows overlap
// sit adjacent and their aligned bars line up visually.
function clusterByOverlap(clients: Client[]): Client[] {
  if (clients.length <= 1) return clients;
  const SPD = (DAY_E - DAY_S) * 2;
  const vecs = clients.map(client =>
    WEEK_DAYS.flatMap(dow => {
      const wins = client.availabilityWindows[dow] ?? [];
      return Array.from({ length: SPD }, (_, si) => {
        const s = DAY_S * 60 + si * 30, e = s + 30;
        return wins.some(w => toMin(w.start) < e && toMin(w.end) > s) ? 1 : 0;
      });
    }),
  );
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const mag = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const sim = (a: number[], b: number[]) => { const ma = mag(a), mb = mag(b); return ma && mb ? dot(a, b) / (ma * mb) : 0; };
  const total = (v: number[]) => v.reduce((s: number, x: number) => s + x, 0);

  const remaining = clients.map((_, i) => i).sort((a, b) => total(vecs[b]) - total(vecs[a]));
  const order: number[] = [remaining.shift()!];
  while (remaining.length) {
    const last = order[order.length - 1];
    let best = 0, bestSim = -1;
    for (let i = 0; i < remaining.length; i++) {
      const s = sim(vecs[last], vecs[remaining[i]]);
      if (s > bestSim) { bestSim = s; best = i; }
    }
    order.push(remaining.splice(best, 1)[0]);
  }
  return order.map(i => clients[i]);
}
