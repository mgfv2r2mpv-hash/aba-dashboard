/**
 * SAssiMark — the assistant's live identity. The ensō is an open dark ring with
 * a red count badge while issues remain, and closes into a full "future green"
 * circle with a soft glow + check when the week is in order. The wordmark shifts
 * to sAssI (A and I in --ai-bright) while AI has work, and back to plain SAssi.
 */
export function Enso({ count, size = 44 }: { count: number; size?: number }) {
  const closed = count === 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      style={{
        filter: closed ? 'drop-shadow(0 0 5px rgba(0, 207, 122, 0.6))' : 'none',
        transition: 'filter var(--duration-slow) var(--ease-standard)',
      }}
    >
      <circle
        cx="22"
        cy="22"
        r="17"
        fill="none"
        stroke={closed ? 'var(--ai-bright)' : '#3a4448'}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={closed ? 'none' : '92 30'}
        transform="rotate(64 22 22)"
      />
      {closed ? (
        <path
          d="M15 22.5 l5 5 l9 -10"
          fill="none"
          stroke="var(--ai-bright)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <g>
          <circle cx="22" cy="22" r="9.5" fill="var(--red-500)" />
          <text
            x="22"
            y="26.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="#ffffff"
            fontFamily="var(--font-sans)"
          >
            {count}
          </text>
        </g>
      )}
    </svg>
  );
}

export function SAssiWord({ ai }: { ai: boolean }) {
  if (!ai) return <span>SAssi</span>;
  const g = { color: 'var(--ai-bright)' };
  return (
    <span>
      <span style={{ textTransform: 'lowercase' }}>s</span>
      <span style={g}>A</span>
      ss
      <span style={g}>I</span>
    </span>
  );
}
