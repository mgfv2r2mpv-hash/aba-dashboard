import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CprSession, ObservationCode, ObservationEvent, EventCategory } from '../cpr/types';

interface Props {
  session: CprSession;
  onEnd: (session: CprSession) => void;
  onCancel: () => void;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const CAT_STYLE: Record<EventCategory, { header: string; headerText: string }> = {
  antecedent:  { header: '#fef3c7', headerText: '#92400e' },
  behavior:    { header: '#fee2e2', headerText: '#991b1b' },
  consequence: { header: '#d1fae5', headerText: '#065f46' },
};

const CAT_LABEL: Record<EventCategory, string> = {
  antecedent: 'Antecedents',
  behavior: 'Behaviors',
  consequence: 'Consequences',
};

function CodeButton({ code, onTap, flash }: {
  code: ObservationCode;
  onTap: (code: ObservationCode) => void;
  flash: boolean;
}) {
  return (
    <button
      onPointerDown={() => onTap(code)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '10px 6px', borderRadius: 12, cursor: 'pointer',
        border: `2px solid ${code.color}`,
        background: flash ? code.color : code.color + '22',
        transition: 'background 0.12s, transform 0.06s',
        transform: flash ? 'scale(0.95)' : 'scale(1)',
        minHeight: 68, minWidth: 72,
        userSelect: 'none', WebkitUserSelect: 'none',
        touchAction: 'none',
      }}
    >
      <span style={{
        fontSize: 16, fontWeight: 800, color: flash ? '#fff' : code.color,
        letterSpacing: '-0.3px',
      }}>{code.abbr}</span>
      <span style={{
        fontSize: 10, color: flash ? 'rgba(255,255,255,0.85)' : '#374151',
        marginTop: 3, textAlign: 'center', lineHeight: 1.2,
        maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>{code.label}</span>
    </button>
  );
}

export default function CprRecorder({ session: initialSession, onEnd, onCancel }: Props) {
  const [events, setEvents] = useState<ObservationEvent[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  const [confirmEnd, setConfirmEnd] = useState(false);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const recordEvent = useCallback((code: ObservationCode) => {
    const ts = Date.now() - startTimeRef.current;
    const newEvent: ObservationEvent = {
      id: crypto.randomUUID(),
      ts,
      codeId: code.id,
    };
    setEvents(prev => [...prev, newEvent]);
    // Flash feedback
    setFlash(f => ({ ...f, [code.id]: true }));
    setTimeout(() => setFlash(f => ({ ...f, [code.id]: false })), 160);
  }, []);

  const undoLast = useCallback(() => {
    setEvents(prev => prev.slice(0, -1));
  }, []);

  function handleEnd() {
    const finalSession: CprSession = {
      ...initialSession,
      events,
      durationMs: elapsedMs,
    };
    if (timerRef.current) clearInterval(timerRef.current);
    onEnd(finalSession);
  }

  const codes = initialSession.codeSetSnapshot.codes;
  const antecedents = codes.filter(c => c.category === 'antecedent');
  const behaviors   = codes.filter(c => c.category === 'behavior');
  const consequences = codes.filter(c => c.category === 'consequence');

  const groups: Array<{ cat: EventCategory; codes: ObservationCode[] }> = (
    [
      { cat: 'antecedent' as EventCategory, codes: antecedents },
      { cat: 'behavior' as EventCategory, codes: behaviors },
      { cat: 'consequence' as EventCategory, codes: consequences },
    ] as const
  ).filter(g => g.codes.length > 0);

  const targetCode = codes.find(c => c.id === initialSession.targetBehaviorId);
  const lastFiveEvents = events.slice(-40).reverse();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', flexDirection: 'column',
      background: '#f8fafc',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px',
        background: '#1e293b', color: '#fff',
        flexShrink: 0,
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
      }}>
        <button
          onClick={() => setConfirmEnd(true)}
          style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', borderRadius: 8, padding: '5px 10px',
            fontSize: 13, cursor: 'pointer', fontWeight: 600,
          }}
        >← Back</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>{initialSession.clientLabel}</div>
          <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
            {fmtMs(elapsedMs)}
          </div>
        </div>
        <button
          onClick={() => setConfirmEnd(true)}
          style={{
            background: '#dc2626', border: 'none', color: '#fff',
            borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer',
            fontWeight: 700,
          }}
        >End</button>
      </div>

      {/* Target behavior banner */}
      {targetCode && (
        <div style={{
          background: targetCode.color + '18',
          borderBottom: `2px solid ${targetCode.color}44`,
          padding: '5px 16px', flexShrink: 0,
          fontSize: 12, color: '#374151',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 10, color: '#6b7280' }}>Criterion behavior:</span>
          <span style={{
            background: targetCode.color, color: '#fff',
            borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700,
          }}>{targetCode.abbr}</span>
          <span style={{ fontWeight: 600 }}>{targetCode.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>
            {events.filter(e => e.codeId === targetCode.id).length} occurrences
          </span>
        </div>
      )}

      {/* Code button grid */}
      <div style={{
        display: 'flex', gap: 0, overflowX: 'auto',
        flex: 1, minHeight: 0,
      }}>
        {groups.map(({ cat, codes: groupCodes }) => (
          <div key={cat} style={{
            flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
            borderRight: cat !== 'consequence' ? '1px solid #e5e7eb' : undefined,
          }}>
            <div style={{
              padding: '8px 10px', textAlign: 'center',
              background: CAT_STYLE[cat].header, color: CAT_STYLE[cat].headerText,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              flexShrink: 0,
            }}>
              {CAT_LABEL[cat].toUpperCase()}
            </div>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8,
              padding: 10, alignContent: 'flex-start', overflowY: 'auto', flex: 1,
            }}>
              {groupCodes.map(code => (
                <CodeButton
                  key={code.id}
                  code={code}
                  onTap={recordEvent}
                  flash={!!flash[code.id]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Event log */}
      <div style={{
        flexShrink: 0, borderTop: '2px solid #e5e7eb',
        background: '#fff', maxHeight: 140,
        display: 'flex', flexDirection: 'column',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 12px', borderBottom: '1px solid #f3f4f6',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 0.5 }}>
            EVENT LOG ({events.length})
          </span>
          <button
            onClick={undoLast}
            disabled={events.length === 0}
            style={{
              fontSize: 12, color: events.length > 0 ? '#6366f1' : '#d1d5db',
              background: 'none', border: 'none', cursor: events.length > 0 ? 'pointer' : 'default',
              fontWeight: 600, padding: '2px 6px',
            }}
          >Undo last</button>
        </div>
        <div ref={logRef} style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
          {lastFiveEvents.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#d1d5db', fontSize: 12, padding: '10px 0' }}>
              Tap a code above to begin recording
            </div>
          ) : lastFiveEvents.map((ev, i) => {
            const code = codes.find(c => c.id === ev.codeId);
            if (!code) return null;
            return (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '3px 12px',
                background: i === 0 ? code.color + '11' : undefined,
              }}>
                <span style={{ fontSize: 11, color: '#9ca3af', fontVariantNumeric: 'tabular-nums', minWidth: 40 }}>
                  {fmtMs(ev.ts)}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: code.color,
                  background: code.color + '22', borderRadius: 4,
                  padding: '1px 5px', minWidth: 30, textAlign: 'center',
                }}>{code.abbr}</span>
                <span style={{ fontSize: 12, color: '#374151' }}>{code.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* End session confirmation */}
      {confirmEnd && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28,
            maxWidth: 340, width: '90%', textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>End session?</div>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 6 }}>
              Duration: {fmtMs(elapsedMs)} · {events.length} events recorded
            </div>
            {events.length < 5 && (
              <div style={{
                fontSize: 12, color: '#92400e', background: '#fef3c7',
                borderRadius: 6, padding: '6px 10px', marginBottom: 12,
              }}>
                Fewer than 5 events recorded. Statistical results may be unreliable.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => setConfirmEnd(false)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #d1d5db',
                  background: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >Keep Recording</button>
              <button
                onClick={handleEnd}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                  background: '#10b981', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >Save & Analyze</button>
            </div>
            <button
              onClick={onCancel}
              style={{
                marginTop: 8, fontSize: 12, color: '#ef4444', background: 'none',
                border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}
            >Discard session</button>
          </div>
        </div>
      )}
    </div>
  );
}
