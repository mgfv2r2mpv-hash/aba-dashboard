import { ScheduleData } from './types';

// The identifier policy has two halves, and only one of them depends on the
// clinician cooperating.
//
//   COACHING (this file's `checkIdentifier`) is advisory. It reads what was
//   typed and says when it looks like a full legal name or a contact detail.
//   It never blocks: a clinician mid-intake who wants to type a real name into
//   their own local file is allowed to, and the warning stands beside it.
//
//   THE UUID BOUNDARY (this file's `findIdentityLeaks`) is not advisory. Every
//   case and technician is minted with a uuid, every link carries that uuid,
//   and the anonymiser sends a per-call token in its place. A clinician who
//   ignores every warning still gets a uuid on the wire. Coaching protects the
//   file and the screen; the uuid protects the network.

export type IdentifierConcern = 'full-name' | 'contact-detail';

export interface IdentifierVerdict {
  concern: IdentifierConcern | null;
  /** Advisory sentence for the clinician. Null when there is nothing to say. */
  message: string | null;
  /** A shorter identifier derived from what they typed, when one is obvious. */
  suggestion: string | null;
}

const OK: IdentifierVerdict = { concern: null, message: null, suggestion: null };

// A "name word" is a capitalised word with real letters after it: Samuel,
// O'Brien, Mary-Jane. The leading run of lowercase is optional so O'Brien and
// D'Angelo match on their second part. Deliberately NOT matched: initials
// (B, B. — caught by the length filter below), codes (SB-04), all-caps
// handles (TT), anything carrying a digit.
const NAME_WORD = /^[A-Z][a-z]*(?:['’\-][A-Z]?[a-z]+)*\.?$/;
const HAS_DIGIT = /\d/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RUN = /\d[\d\s().\-]{6,}\d/;

function nameWords(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter(w => !HAS_DIGIT.test(w) && w.replace(/\.$/, '').length > 1 && NAME_WORD.test(w));
}

/**
 * Read an identifier the way a careful colleague would: say when it looks like
 * something that should not be sitting in a clinical file, and stay quiet
 * otherwise. Never returns a verdict that should stop the entry being saved.
 */
export function checkIdentifier(raw: string): IdentifierVerdict {
  const value = (raw || '').trim();
  if (!value) return OK;

  if (EMAIL.test(value) || PHONE_RUN.test(value)) {
    return {
      concern: 'contact-detail',
      message: 'That looks like a contact detail. An identifier only needs to tell you which case this is.',
      suggestion: null,
    };
  }

  const words = nameWords(value);
  if (words.length >= 2) {
    const initials = words.map(w => w[0]).join('');
    return {
      concern: 'full-name',
      message: 'That looks like a full name. Nothing identifying is ever sent over the network either way — this is about what sits on your screen and in your backup file.',
      suggestion: initials.length >= 2 ? initials : null,
    };
  }

  return OK;
}

// ── The boundary itself ─────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Assert the identity invariant over a schedule: every roster id is a uuid, and
 * every link between records is one of those uuids rather than a typed string.
 *
 * Returns one human-readable line per violation, empty when the schedule holds.
 * Legacy schedules restored from old backups can legitimately carry name refs
 * (see entityRefs.ts, which heals them on load) — this is the check for data
 * this app PRODUCES: setup output, builder output, anything before a send.
 */
export function findIdentityLeaks(data: ScheduleData): string[] {
  const problems: string[] = [];
  const clientIds = new Set<string>();
  const techIds = new Set<string>();

  for (const c of data.clients) {
    if (!isUuid(c.id)) problems.push(`client id is not a uuid: ${JSON.stringify(c.id)}`);
    clientIds.add(c.id);
  }
  for (const t of data.technicians) {
    if (!isUuid(t.id)) problems.push(`technician id is not a uuid: ${JSON.stringify(t.id)}`);
    techIds.add(t.id);
  }

  for (const t of data.technicians) {
    t.assignments.forEach((a, i) => {
      // An unfilled assignment row is a half-finished entry, not a leak.
      if (a.clientId === '') return;
      if (!isUuid(a.clientId)) {
        problems.push(`technician ${t.id} assignment ${i} links a non-uuid client: ${JSON.stringify(a.clientId)}`);
      } else if (!clientIds.has(a.clientId)) {
        problems.push(`technician ${t.id} assignment ${i} links an unknown client id: ${a.clientId}`);
      }
    });
  }

  for (const appt of data.appointments) {
    if (appt.client) {
      if (!isUuid(appt.client)) {
        problems.push(`appointment ${appt.id} links a non-uuid client: ${JSON.stringify(appt.client)}`);
      } else if (!clientIds.has(appt.client)) {
        problems.push(`appointment ${appt.id} links an unknown client id: ${appt.client}`);
      }
    }
    if (appt.technician) {
      if (!isUuid(appt.technician)) {
        problems.push(`appointment ${appt.id} links a non-uuid technician: ${JSON.stringify(appt.technician)}`);
      } else if (!techIds.has(appt.technician)) {
        problems.push(`appointment ${appt.id} links an unknown technician id: ${appt.technician}`);
      }
    }
  }

  return problems;
}
