// Roster context — resolves an immutable client/technician id to its friendly
// display name for the UI. Appointments store ids (see entityRefs.ts); any surface
// that shows a client/tech reads the current name through here, so a rename is
// reflected everywhere with no stale strings. Provided once near the app root.
import { createContext, useContext, useMemo, ReactNode } from 'react';
import { Client, Technician } from './types';
import { nameOf } from './entityRefs';

export interface Roster {
  clientName: (ref?: string | null) => string;
  techName: (ref?: string | null) => string;
}

// Fallback (no provider): echo the ref so nothing renders blank.
const RosterContext = createContext<Roster>({
  clientName: r => r ?? '—',
  techName: r => r ?? '—',
});

export function RosterProvider({
  clients, technicians, children,
}: { clients: Client[]; technicians: Technician[]; children: ReactNode }) {
  const value = useMemo<Roster>(() => ({
    clientName: r => nameOf(clients, r),
    techName: r => nameOf(technicians, r),
  }), [clients, technicians]);
  return <RosterContext.Provider value={value}>{children}</RosterContext.Provider>;
}

export const useRoster = (): Roster => useContext(RosterContext);
