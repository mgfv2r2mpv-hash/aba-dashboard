// What counts as an acceptable password, and what a login is allowed to do next.
//
// Everything here is pure, so the rules can be tested exhaustively without a
// database, a request or a runtime. The endpoints hold no policy of their own: they
// call in here and act on the answer.

export const MIN_PASSWORD_LENGTH = 12;

// PBKDF2 folds any input down to a fixed-size key, so a long password costs no more
// to check than a short one. The cap is here to stop somebody posting a megabyte,
// not because length hurts the hash.
export const MAX_PASSWORD_LENGTH = 256;

export type PasswordRejection =
  | 'not-text'
  | 'too-short'
  | 'too-long'
  | 'blank'
  | 'same-as-old';

export const PASSWORD_RULE = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * Length and substance only. No character-class rules: they push people towards
 * Passw0rd! and away from the long passphrases that actually survive a guess.
 * Returns null when the candidate is acceptable.
 */
export function checkNewPassword(candidate: unknown, current?: string): PasswordRejection | null {
  if (typeof candidate !== 'string') return 'not-text';
  if (candidate.trim().length === 0) return 'blank';
  if (candidate.length < MIN_PASSWORD_LENGTH) return 'too-short';
  if (candidate.length > MAX_PASSWORD_LENGTH) return 'too-long';
  if (current !== undefined && candidate === current) return 'same-as-old';
  return null;
}

export function describeRejection(rejection: PasswordRejection): string {
  switch (rejection) {
    case 'not-text': return 'Send the new password as text.';
    case 'blank': return 'The new password cannot be blank.';
    case 'too-short': return `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
    case 'too-long': return `The new password cannot be longer than ${MAX_PASSWORD_LENGTH} characters.`;
    case 'same-as-old': return 'Pick a password you have not just been using.';
  }
}

// An email is the username. This is deliberately loose: the store cares that two
// people cannot claim the same address, not that the address is deliverable, and a
// strict pattern here only ever locks out somebody with a legitimate odd address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUsableEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 320 && EMAIL_SHAPE.test(value.trim());
}

/**
 * One canonical spelling per address, so Sam@Clinic.org and sam@clinic.org are the
 * same account. The original spelling is kept separately for display; this is only
 * ever the lookup key.
 */
export function foldEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type LoginOutcome =
  | { readonly kind: 'denied' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'must-change-password' }
  | { readonly kind: 'signed-in' };

/**
 * The whole login decision in one place, given facts the caller has already
 * established. A temp password is a real password that happens to be spent: it gets
 * the person through the door and no further, which is why this returns a distinct
 * outcome rather than a session.
 */
export function decideLogin(facts: {
  readonly passwordMatched: boolean;
  readonly disabled: boolean;
  readonly mustChangePassword: boolean;
}): LoginOutcome {
  if (!facts.passwordMatched) return { kind: 'denied' };
  if (facts.disabled) return { kind: 'disabled' };
  if (facts.mustChangePassword) return { kind: 'must-change-password' };
  return { kind: 'signed-in' };
}

export const SESSION_TTL_HOURS = 12;

// The window a person gets to set their own password after a temp one let them in.
// Short on purpose: it is a password-change ticket, not a session.
export const CHANGE_TICKET_TTL_MINUTES = 15;

export function expiryFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function hasExpired(expiresAt: string, now: Date): boolean {
  const at = Date.parse(expiresAt);
  return !Number.isFinite(at) || at <= now.getTime();
}
