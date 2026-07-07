// Canonical home for entity-reference logic — Clients and Technicians are linked
// by their IMMUTABLE id, never by display name. This module replaces the ~5
// duplicated "id-or-name" resolver factories and the dozens of inline
// `x.id === ref || x.name === ref` matchers that used to be scattered across the
// codebase (compliance, builders, solvers, components). After the v2→v3 migration
// normalizes stored refs to ids, everything downstream compares ids directly and
// resolves names for DISPLAY only through here.
//
// Renaming an entity now can never break a link: the name is display data, the id
// is identity. The one place name→id matching still happens is `resolveRefToId`,
// used exclusively by the one-time migration to heal legacy name-based refs.

export interface EntityLike { id: string; name: string; }

// Index a list by id for O(1) lookup.
export function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map(e => [e.id, e]));
}

// Resolve a stored reference (now always an id) to its display name. Falls back to
// the raw ref when the entity is missing (deleted / not-yet-healed orphan), so the
// UI shows *something* rather than blank. `—` for an absent ref.
export function nameOf(entities: readonly EntityLike[], ref: string | undefined | null): string {
  if (!ref) return '—';
  return entities.find(e => e.id === ref)?.name ?? ref;
}

export interface RefResolution {
  id?: string;        // resolved canonical id
  ambiguous?: boolean; // matched >1 entity — do NOT auto-heal, surface for manual fixup
}

// Normalize a name for fuzzy healing: case- and punctuation/space-insensitive.
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// MIGRATION-ONLY. Resolve a legacy reference (which may be an id, an exact current
// name, or a STALE name left over from a rename) to a current entity id:
//   1. exact id            → heal
//   2. exact current name  → heal iff unique (duplicate names → ambiguous)
//   3. unique normalized/prefix match (e.g. "Toniel" → the only tech "Toniel T")
//                          → heal iff exactly one entity matches
//   4. otherwise           → unresolved ({}), caller PRESERVES the raw ref (no data loss)
//                            and reports it for manual reassignment.
// This is the ONLY sanctioned name→id path; all runtime code compares ids directly.
export function resolveRefToId(ref: string | undefined | null, entities: readonly EntityLike[]): RefResolution {
  if (!ref) return {};
  if (entities.some(e => e.id === ref)) return { id: ref };

  const exact = entities.filter(e => e.name === ref);
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) return { ambiguous: true };

  const nref = normalize(ref);
  if (!nref) return {};
  const near = entities.filter(e => {
    const ne = normalize(e.name);
    return ne.length > 0 && (ne === nref || ne.startsWith(nref) || nref.startsWith(ne));
  });
  const uniq = [...byId(near).values()];
  if (uniq.length === 1) return { id: uniq[0].id };
  if (uniq.length > 1) return { ambiguous: true };
  return {};
}
