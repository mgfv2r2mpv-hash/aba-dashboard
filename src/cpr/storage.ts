import type { CprSession } from './types';

const KEY = 'cpr_sessions_v1';

export function loadSessions(): CprSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CprSession[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: CprSession[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch { /* ignore quota errors */ }
}

export function upsertSession(session: CprSession): CprSession[] {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === session.id);
  const next = idx >= 0
    ? sessions.map((s, i) => (i === idx ? session : s))
    : [...sessions, session];
  saveSessions(next);
  return next;
}

export function deleteSession(id: string): CprSession[] {
  const sessions = loadSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  return sessions;
}
