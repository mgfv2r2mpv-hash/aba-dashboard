// File-password strength policy. Enforced wherever a password ENCRYPTS a file:
// the app's backup / schedule-password prompts and the web portal's Save. It is
// deliberately NOT applied to decrypt-ENTRY (an existing file must open regardless
// of its password's strength) nor to the numeric app-lock PIN (its own rules).
//
// Safety: a password value here is only ever PBKDF2 key material (clientCrypto
// .deriveKey) — never interpolated into SQL/HTML/a shell/eval, never rendered into
// markup — so every character (including ' " ` * ; -) is allowed. All checks are
// linear scans over a length-capped string; the only regex (/[a-z]+/g) is a simple
// character class with no backtracking, so there is no ReDoS surface.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const MIN_DIGITS = 2;
export const MIN_SPECIAL = 2;
// Shortest letter-run substring compared against the dictionary. A word broken by
// a digit (encr4ypt) yields runs below this floor, which is what lets an inserted
// digit legitimately defeat the dictionary check.
export const DICT_MIN_RUN = 4;

export interface PasswordRule {
  id: string;
  label: string;
  ok: boolean;
}

export interface PasswordResult {
  valid: boolean;
  rules: PasswordRule[];
}

const isUpper = (c: number): boolean => c >= 65 && c <= 90;
const isLower = (c: number): boolean => c >= 97 && c <= 122;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLetter = (c: number): boolean => isUpper(c) || isLower(c);
// Space, tab, LF, CR, FF, VT, and non-breaking space.
const isSpace = (c: number): boolean =>
  c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 0x00a0;
const toLowerCode = (c: number): number => (isUpper(c) ? c + 32 : c);

interface CharCounts { upper: number; lower: number; digits: number; special: number; }

function countChars(pw: string): CharCounts {
  let upper = 0, lower = 0, digits = 0, special = 0;
  for (let i = 0; i < pw.length; i++) {
    const c = pw.charCodeAt(i);
    if (isUpper(c)) upper++;
    else if (isLower(c)) lower++;
    else if (isDigit(c)) digits++;
    else if (!isSpace(c)) special++; // any non-alphanumeric, non-space char
  }
  return { upper, lower, digits, special };
}

// A forbidden run of 3+ letters consecutive in the alphabet, ascending OR
// descending (abc, cba, xyz, qrs) — case-insensitive.
function hasLetterRun(pw: string): boolean {
  for (let i = 0; i + 2 < pw.length; i++) {
    const a = pw.charCodeAt(i), b = pw.charCodeAt(i + 1), c = pw.charCodeAt(i + 2);
    if (!isLetter(a) || !isLetter(b) || !isLetter(c)) continue;
    const la = toLowerCode(a), lb = toLowerCode(b), lc = toLowerCode(c);
    if ((lb === la + 1 && lc === lb + 1) || (lb === la - 1 && lc === lb - 1)) return true;
  }
  return false;
}

// A forbidden run of 2+ adjacent digits consecutive in value, either direction
// (45, 54, 98). '0'..'9' are contiguous char codes, so the code delta is the
// value delta.
function hasDigitRun(pw: string): boolean {
  for (let i = 0; i + 1 < pw.length; i++) {
    const a = pw.charCodeAt(i), b = pw.charCodeAt(i + 1);
    if (isDigit(a) && isDigit(b) && Math.abs(a - b) === 1) return true;
  }
  return false;
}

// "Based on a dictionary word": any maximal letter run (lowercased) contains a
// dictionary entry of length ≥ DICT_MIN_RUN as a substring. Runs are short (the
// password is length-capped), so the O(run²) substring scan is trivial.
function basedOnDictionary(pw: string, dict: ReadonlySet<string>): boolean {
  const runs = pw.toLowerCase().match(/[a-z]+/g);
  if (!runs) return false;
  for (const run of runs) {
    if (run.length < DICT_MIN_RUN) continue;
    for (let start = 0; start + DICT_MIN_RUN <= run.length; start++) {
      for (let end = start + DICT_MIN_RUN; end <= run.length; end++) {
        if (dict.has(run.slice(start, end))) return true;
      }
    }
  }
  return false;
}

// Validate a candidate file password. Pass the loaded dictionary set to include
// the `notDictionary` rule; omit it (e.g. before the async dictionary import
// resolves) and that one rule is left out of the result — `valid` then reflects
// only the synchronous rules, and the caller re-validates with the dict for the
// final gate.
export function validatePassword(pw: string, dict?: ReadonlySet<string>): PasswordResult {
  const { upper, lower, digits, special } = countChars(pw);
  const len = pw.length;

  const rules: PasswordRule[] = [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`, ok: len >= PASSWORD_MIN_LENGTH && len <= PASSWORD_MAX_LENGTH },
    { id: 'upper', label: 'An uppercase letter', ok: upper >= 1 },
    { id: 'lower', label: 'A lowercase letter', ok: lower >= 1 },
    { id: 'digits', label: `At least ${MIN_DIGITS} numbers`, ok: digits >= MIN_DIGITS },
    { id: 'special', label: `At least ${MIN_SPECIAL} special characters`, ok: special >= MIN_SPECIAL },
    { id: 'noSpaceEnds', label: 'No leading or trailing spaces', ok: len > 0 && !isSpace(pw.charCodeAt(0)) && !isSpace(pw.charCodeAt(len - 1)) },
    { id: 'letterSeq', label: 'No 3+ letters in alphabetical order (abc, zyx)', ok: !hasLetterRun(pw) },
    { id: 'digitSeq', label: 'No 2+ numbers in sequence (45, 98)', ok: !hasDigitRun(pw) },
  ];
  if (dict) {
    rules.push({ id: 'notDictionary', label: 'Not based on a dictionary word', ok: !basedOnDictionary(pw, dict) });
  }

  return { valid: rules.every((r) => r.ok), rules };
}
