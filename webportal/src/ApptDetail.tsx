import React, { useEffect, useRef } from 'react';
import { Appointment } from '@shared/types';
import { format } from 'date-fns';

export default function ApptDetail({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const start = new Date(appt.startTime);
  const end   = new Date(appt.endTime);
  const dur   = Math.round((end.getTime() - start.getTime()) / 60000);
  const rows: [string, string | undefined][] = [
    ['Date',        format(start, 'EEEE, MMMM d, yyyy')],
    ['Time',        `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')} (${dur} min)`],
    ['Type',        appt.type],
    ['Client',      appt.client],
    ['Technician',  appt.technician],
    ['Description', appt.description],
    appt.status === 'canceled' && appt.cancellation?.reason
      ? ['Reason', appt.cancellation.reason]
      : undefined,
    appt.isRecurring ? ['Recurring', appt.recurringPattern ?? 'Yes'] : undefined,
  ].filter((r): r is [string, string | undefined] => !!r);

  const badgeCls = `appt-status-badge ${appt.status ?? 'scheduled'}`;
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="appt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appt-title"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="appt-sheet">
        <div className="appt-sheet-handle" aria-hidden="true" />
        <div className="appt-sheet-hd">
          <div>
            <div className="appt-sheet-title" id="appt-title">{appt.title}</div>
            <span className={badgeCls} style={{ marginTop: 4, display: 'inline-block' }}>
              {appt.status ?? 'scheduled'}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="appt-detail-grid">
          {rows.map(([key, val]) =>
            val ? (
              <div className="appt-detail-row" key={key}>
                <span className="appt-detail-key">{key}</span>
                <span className="appt-detail-val">{val}</span>
              </div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
