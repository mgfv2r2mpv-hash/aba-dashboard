// Anonymization layer for PII protection.
//
// Even when a user enters real names ("John Doe") into the schedule,
// no identifiable string is allowed to leave this server toward Claude.
// We replace every name and free-text field with opaque tokens before
// any external API call, then restore the originals when applying results.
//
// Tokens used:
//   CLIENT_<n>   for client identifiers
//   TECH_<n>     for technician identifiers
//   APT_<n>      for appointment identifiers
//
// Free-text fields (title, description, notes) are scrubbed: any token
// resembling a real name is removed entirely. We only keep enums (type,
// recurringPattern), times, booleans, and numbers.

import { ScheduleData, Appointment, Technician, Client } from './types';

export interface AnonymizationMap {
  clients: Map<string, string>;       // realName/realId -> CLIENT_n
  technicians: Map<string, string>;   // realName/realId -> TECH_n
  appointments: Map<string, string>;  // realId -> APT_n
  reverse: Map<string, string>;       // token -> original (for de-anonymizing replies)
}

export function buildAnonymizationMap(data: ScheduleData): AnonymizationMap {
  const map: AnonymizationMap = {
    clients: new Map(),
    technicians: new Map(),
    appointments: new Map(),
    reverse: new Map(),
  };

  data.clients.forEach((c, i) => {
    const token = `CLIENT_${i + 1}`;
    map.clients.set(c.id, token);
    map.clients.set(c.name, token);
    map.reverse.set(token, c.name);
  });

  data.technicians.forEach((t, i) => {
    const token = `TECH_${i + 1}`;
    map.technicians.set(t.id, token);
    map.technicians.set(t.name, token);
    map.reverse.set(token, t.name);
  });

  data.appointments.forEach((a, i) => {
    const token = `APT_${i + 1}`;
    map.appointments.set(a.id, token);
    map.reverse.set(token, a.id);
  });

  return map;
}

// Strip free-text fields entirely - we cannot trust them to be PHI-free.
// We only keep structured/enum fields that the scheduler actually needs.
function scrubAppointment(a: Appointment, map: AnonymizationMap): any {
  return {
    id: map.appointments.get(a.id) || `APT_unknown`,
    technician: a.technician ? (map.technicians.get(a.technician) || 'TECH_unknown') : null,
    client: a.client ? (map.clients.get(a.client) || 'CLIENT_unknown') : null,
    startTime: a.startTime,
    endTime: a.endTime,
    isFixed: a.isFixed,
    isBillable: a.isBillable,
    type: a.type,
    isRecurring: !!a.isRecurring,
    recurringPattern: a.recurringPattern || null,
    // NOTE: title, description, notes intentionally omitted to prevent PHI leakage
  };
}

function scrubTechnician(t: Technician, map: AnonymizationMap): any {
  return {
    id: map.technicians.get(t.id) || 'TECH_unknown',
    isRBT: t.isRBT,
    assignments: t.assignments.map(a => ({
      clientId: map.clients.get(a.clientId) || 'CLIENT_unknown',
      hoursPerWeek: a.hoursPerWeek,
      billable: a.billable,
    })),
    availability: t.availability,
    // NOTE: name and notes intentionally omitted
  };
}

function scrubClient(c: Client, map: AnonymizationMap): any {
  return {
    id: map.clients.get(c.id) || 'CLIENT_unknown',
    availabilityWindows: c.availabilityWindows,
    // NOTE: name and notes intentionally omitted
  };
}

export interface AnonymizedSchedule {
  technicians: any[];
  clients: any[];
  appointments: any[];
  settings: any;
  blackouts: any[];
  timeOff: any[];
}

export function anonymizeSchedule(data: ScheduleData, map: AnonymizationMap): AnonymizedSchedule {
  return {
    technicians: data.technicians.map(t => scrubTechnician(t, map)),
    clients: data.clients.map(c => scrubClient(c, map)),
    appointments: data.appointments.map(a => scrubAppointment(a, map)),
    settings: data.settings,
    blackouts: (data.blackouts || []).map(b => ({
      entity: b.entityType === 'client'
        ? (map.clients.get(b.entityId) || map.clients.get(b.entityName || '') || 'CLIENT_unknown')
        : (map.technicians.get(b.entityId) || map.technicians.get(b.entityName || '') || 'TECH_unknown'),
      date: b.date,
      ...(b.reason ? { reason: b.reason } : {}),
    })),
    timeOff: (data.timeOff || []).map(t => ({ date: t.date, hours: t.hours })),
  };
}

export function anonymizeAppointment(a: Appointment, map: AnonymizationMap): any {
  return scrubAppointment(a, map);
}

// Scrub a free-text string of any names that appear in the schedule.
// This is a defensive pass for conflict messages built from user data.
//
// We first protect any already-inserted CLIENT_n/TECH_n/APT_n tokens behind
// null-byte placeholders so that short client names (e.g. "CL") can't corrupt
// them when they are replaced globally (e.g. "CLIENT_1" → "CLIENT_4IENT_1").
export function scrubText(text: string, data: ScheduleData, map: AnonymizationMap): string {
  // Step 1: stash existing tokens so name replacements can't touch them.
  const saved: string[] = [];
  let result = text.replace(/\b(CLIENT_\d+|TECH_\d+|APT_\d+)\b/g, (m) => {
    const idx = saved.length;
    saved.push(m);
    return `\x00${idx}\x00`;
  });

  // Step 2: replace real names, longest first so "John Smith" beats "John". Each
  // significant name COMPONENT is registered too, so a bare first/last name
  // ("Ethan") is tokenized, not only the exact full "Ethan Carter" — the chat's
  // free-text path leans on this. Length-gated (≥3) and word-bounded; over-scrubbing
  // is the safe direction for PHI (a human reviews the de-anonymized proposal).
  const replacements: { from: string; to: string }[] = [];
  const pushEntity = (name: string | undefined, to: string) => {
    if (!name) return;
    replacements.push({ from: name, to });
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3) replacements.push({ from: part, to });
    }
  };
  data.clients.forEach(c => pushEntity(c.name, map.clients.get(c.name) || 'CLIENT_X'));
  data.technicians.forEach(t => pushEntity(t.name, map.technicians.get(t.name) || 'TECH_X'));
  replacements.sort((a, b) => b.from.length - a.from.length);
  for (const { from, to } of replacements) {
    if (!from) continue;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word-bounded so a short component can't corrupt a longer word ("Sam" in "Samantha").
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), to);
  }

  // Step 3: restore saved tokens.
  result = result.replace(/\x00(\d+)\x00/g, (_, i) => saved[parseInt(i)] ?? '');
  return result;
}

// ── Local entity resolution (pre-scrub) ──────────────────────────────────────
// Claude never sees names, so it cannot map a shorthand the user types ("SB",
// "Sammy") to a token — that resolution has to happen locally, before the text is
// scrubbed and sent. resolveClientReferences rewrites unambiguous shorthands to
// the client's canonical name (which scrubText then tokenizes) and reports any
// shorthand that matches more than one client so the caller can disambiguate.

export interface EntityCandidate { id: string; name: string; }
export interface EntityAmbiguity { ref: string; candidates: EntityCandidate[]; }
export interface EntityResolution { text: string; ambiguities: EntityAmbiguity[]; }

// First letter of each whitespace-delimited word, uppercased and letter-only:
// "Sam Brown" -> "SB", "Mary Jane Watson" -> "MJW".
function clientInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().replace(/[^A-Z]/g, '');
}

// All-caps tokens that are overwhelmingly ABA/scheduling terms, not name references
// — the AUTO-DERIVED initials path must never rewrite these (an explicit alias still
// wins). e.g. "add PT" must stay parent-training, not become a client named "Pat T.".
const RESERVED_INITIALS = new Set([
  'PT', 'BT', 'OT', 'ST', 'SLP', 'RBT', 'BCBA', 'ABA', 'EI', 'CC', 'PTO', 'IEP',
  'AM', 'PM', 'OK', 'ID', 'TV', 'NO', 'ASAP', 'FYI', 'ABC',
]);

// Resolve short client references a user typed to the client's full name, locally.
// Aliases match case-insensitively; initials match only an ALL-CAPS token (SB,
// S.B.) so a lowercase word can't false-fire. Unambiguous refs are rewritten to
// the full name (scrubText tokenizes it next); a ref matching >1 client is
// returned as an ambiguity (never rewritten). Full names are left untouched —
// scrubText already handles those.
export function resolveClientReferences(text: string, data: ScheduleData): EntityResolution {
  const aliasIndex = new Map<string, EntityCandidate[]>();     // lowercased alias -> clients
  const initialsIndex = new Map<string, EntityCandidate[]>();  // uppercased initials -> clients
  const add = (idx: Map<string, EntityCandidate[]>, key: string, cand: EntityCandidate) => {
    const arr = idx.get(key) || [];
    if (!arr.some(c => c.id === cand.id)) arr.push(cand);
    idx.set(key, arr);
  };
  for (const c of data.clients) {
    if (!c.name) continue;
    const cand: EntityCandidate = { id: c.id, name: c.name };
    (c.aliases || []).forEach(a => { const k = (a || '').trim().toLowerCase(); if (k) add(aliasIndex, k, cand); });
    const ini = clientInitials(c.name);
    if (ini.length >= 2) add(initialsIndex, ini, cand);
  }

  const ambiguities: EntityAmbiguity[] = [];
  const seen = new Set<string>();
  // Word-ish tokens only; internal . ' - kept so "S.B." / "O'Neil" survive as one.
  const out = text.replace(/[A-Za-z][A-Za-z.'-]*/g, (word) => {
    let cands = aliasIndex.get(word.toLowerCase());
    if (!cands) {
      const stripped = word.replace(/[.-]/g, '');
      if (stripped.length >= 2 && /^[A-Z]+$/.test(stripped) && !RESERVED_INITIALS.has(stripped)) cands = initialsIndex.get(stripped);
    }
    if (!cands || cands.length === 0) return word;
    if (cands.length === 1) return cands[0].name;
    const key = word.toLowerCase();
    if (!seen.has(key)) { seen.add(key); ambiguities.push({ ref: word, candidates: cands.slice() }); }
    return word;
  });
  return { text: out, ambiguities };
}

// True if any client/technician full name OR significant name component (≥3 chars)
// survives in the text as a standalone word. The fail-closed backstop for the chat
// path: no request is sent while a roster name token is still present after scrub.
export function containsEntityName(text: string, data: ScheduleData): boolean {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names: string[] = [];
  const collect = (name?: string) => {
    if (!name) return;
    if (name.length > 1) names.push(name);
    for (const part of name.split(/\s+/)) if (part.length >= 3) names.push(part);
  };
  data.clients.forEach(c => collect(c.name));
  data.technicians.forEach(t => collect(t.name));
  return names.some(n => new RegExp(`\\b${esc(n)}\\b`, 'i').test(text));
}

// De-anonymize tokens in a string back to original values.
export function deAnonymizeText(text: string, map: AnonymizationMap): string {
  let result = text;
  // Replace longest tokens first
  const tokens = Array.from(map.reverse.keys()).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const original = map.reverse.get(token);
    if (original) {
      result = result.replace(new RegExp(token, 'g'), original);
    }
  }
  return result;
}
