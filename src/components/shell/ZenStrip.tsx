/**
 * ZenStrip — the ambient "you are here" band under the command bar. Left: the
 * current moment + what's next. Right: conflict/compliance flag pills, or a calm
 * "no open items" when the queue is clear.
 */
export interface ZenStripProps {
  hereText: string;
  nextText?: string;
  conflictCount?: number;
  complianceCount?: number;
  onFlagClick?: () => void;
}

export function ZenStrip({
  hereText,
  nextText,
  conflictCount = 0,
  complianceCount = 0,
  onFlagClick,
}: ZenStripProps) {
  const clear = conflictCount === 0 && complianceCount === 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '9px 20px',
        background: 'var(--sage-100)',
        borderBottom: '1px solid var(--sage-200)',
        fontSize: 12.5,
        color: 'var(--sage-800)',
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 800 }}>{hereText}</span>
      {nextText && (
        <>
          <span style={{ color: 'var(--sage-300)' }}>·</span>
          <span
            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
          >
            {nextText}
          </span>
        </>
      )}
      <div style={{ flex: 1, minWidth: 8 }} />
      {clear ? (
        <span style={{ color: 'var(--sage-700)', fontWeight: 700 }}>○ No open items</span>
      ) : (
        <>
          {conflictCount > 0 && (
            <Flag
              onClick={onFlagClick}
              fg="var(--amber-700)"
              bg="var(--amber-100)"
              label={`⚠ ${conflictCount} conflict${conflictCount > 1 ? 's' : ''}`}
            />
          )}
          {complianceCount > 0 && (
            <Flag
              onClick={onFlagClick}
              fg="var(--status-over)"
              bg="var(--status-over-bg)"
              label={`${complianceCount} compliance`}
            />
          )}
        </>
      )}
    </div>
  );
}

function Flag({
  label,
  fg,
  bg,
  onClick,
}: {
  label: string;
  fg: string;
  bg: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontWeight: 700,
        padding: '2px 9px',
        borderRadius: 'var(--radius-pill)',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 11.5,
        fontFamily: 'var(--font-sans)',
        color: fg,
        background: bg,
      }}
    >
      {label}
    </button>
  );
}
