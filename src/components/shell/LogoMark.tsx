/**
 * LogoMark — the No Outcome ABA brand mark (ensō + mountain-N). Inlined so the
 * rail has no asset dependency. Mirrors packages/shared/ui/logo-mark.svg.
 * At small sizes this mark is preferred over the EMERGENT app icon.
 */
export interface LogoMarkProps {
  size?: number;
  title?: string;
}

export function LogoMark({ size = 34, title = 'No Outcome ABA' }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="100" cy="100" r="79" fill="#a6c2cf" />
      <path
        d="M64 150 L64 84 L136 150 L136 84"
        fill="none"
        stroke="#51616a"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="100"
        cy="100"
        r="82"
        fill="none"
        stroke="#3a4448"
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray="446 69"
        transform="rotate(64 100 100)"
      />
    </svg>
  );
}
