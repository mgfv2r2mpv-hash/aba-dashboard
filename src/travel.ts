// Travel-time model for the single BCBA ("same human body").
//
// The BCBA physically drives between client sessions, starting/ending at home.
// This module answers ONE question deterministically and OFFLINE: "how many
// minutes must sit between a session at location A and a session at location B,
// leaving at a given time?" — so the scheduler can't teleport the BCBA.
//
// Determinism boundary: everything here is a pure function of a `TravelContext`
// built from already-persisted data (city centroids + a routed-duration cache).
// The network (Google) is confined to src/routing.ts, which fills that cache
// ahead of time. On a cache miss we fall back to an offline haversine estimate
// so the builder never blocks or fails — and the fallback is flagged, not silent.
//
// HIPAA: localities are CITY-LEVEL only (Client.city); the sole exact address is
// the user's own home base. Coordinates here are public city centroids or the
// home — never a client's real address.

import {
  ScheduleData, CompanySettings, TravelSettings, DEFAULT_TRAVEL_SETTINGS, LatLng,
} from './types';

// Location key for a session: a client id, the literal home base, or undefined
// for a location-neutral session (e.g. case-planning that can happen anywhere).
export const HOME_KEY = 'HOME';
export type LocKey = string | undefined; // clientId | 'HOME' | undefined

// Roads are longer than the straight line — inflate haversine for the offline
// fallback so it isn't wildly optimistic.
const ROAD_CIRCUITY = 1.3;
const MEAN_EARTH_RADIUS_MILES = 3958.8;

export type TravelSource =
  | 'same'        // same site (same key) or a location-neutral session → 0
  | 'unknown'     // a locality has no city set → no constraint (0), flagged
  | 'within-city' // two clients in one city → flat floor
  | 'routed'      // real traffic-aware Google duration (from cache) + pad
  | 'fallback';   // cache miss → offline haversine estimate (or defaultUnknownMin)

export interface TravelEstimate {
  minutes: number;
  source: TravelSource;
}

// Everything the pure model needs, all read synchronously.
export interface TravelContext {
  settings: TravelSettings;
  // normalized city label ('home' handled separately) → centroid
  centers: Map<string, LatLng>;
  // cacheKey(fromLabel,toLabel,dow,hour) → raw routed minutes (pre-pad)
  cache: Map<string, number>;
  homeBase?: CompanySettings['homeBase'];
  // clientId → its normalized locality label (its city, lowercased/trimmed)
  clientLoc: Map<string, string>;
}

// ── label / normalization helpers ──────────────────────────────────────────
// A "locality label" is what the cache/centroid maps are keyed by: 'HOME' for
// the home base, otherwise the client's normalized city. undefined = unknown.
export function normalizeCity(city: string | undefined): string | undefined {
  const c = (city || '').trim().toLowerCase();
  return c.length ? c : undefined;
}

export function dowOf(ms: number): number {
  return new Date(ms).getDay(); // 0=Sun … 6=Sat, local
}

export function hourBucket(ms: number, bucketSize: number): number {
  const size = bucketSize > 0 ? bucketSize : 1;
  return Math.floor(new Date(ms).getHours() / size) * size;
}

export function cacheKey(from: string, to: string, dow: number, hour: number): string {
  return `${from}|${to}|${dow}|${hour}`;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * MEAN_EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ── context construction ────────────────────────────────────────────────────
export function travelSettingsOf(settings: CompanySettings): TravelSettings {
  return { ...DEFAULT_TRAVEL_SETTINGS, ...(settings.travel || {}) };
}

export function buildTravelContext(data: ScheduleData): TravelContext {
  const s = data.settings;
  const settings = travelSettingsOf(s);

  const centers = new Map<string, LatLng>();
  for (const cc of s.cityCenters || []) {
    const label = normalizeCity(cc.city);
    if (label && Number.isFinite(cc.lat) && Number.isFinite(cc.lng)) {
      centers.set(label, { lat: cc.lat, lng: cc.lng });
    }
  }

  const cache = new Map<string, number>();
  for (const e of s.travelCache || []) {
    if (!Number.isFinite(e.minutes)) continue;
    const from = normalizeLabel(e.from);
    const to = normalizeLabel(e.to);
    if (!from || !to) continue;
    cache.set(cacheKey(from, to, e.dow, e.hour), e.minutes);
  }

  const clientLoc = new Map<string, string>();
  for (const c of data.clients) {
    const label = normalizeCity(c.city);
    if (label) clientLoc.set(c.id, label);
  }

  return { settings, centers, cache, homeBase: s.homeBase, clientLoc };
}

// 'HOME' is a distinct locality label from every city (home has exact coords).
function normalizeLabel(raw: string): string | undefined {
  if (raw === HOME_KEY) return HOME_KEY;
  return normalizeCity(raw);
}

// ── the model ────────────────────────────────────────────────────────────────
function localityLabel(key: LocKey, ctx: TravelContext): string | undefined {
  if (key === undefined) return undefined;
  if (key === HOME_KEY) return HOME_KEY;
  return ctx.clientLoc.get(key);
}

function centroidOf(key: LocKey, ctx: TravelContext): LatLng | undefined {
  if (key === HOME_KEY) {
    const h = ctx.homeBase;
    if (h && Number.isFinite(h.lat) && Number.isFinite(h.lng)) {
      return { lat: h.lat as number, lng: h.lng as number };
    }
    const hc = normalizeCity(h?.city);
    return hc ? ctx.centers.get(hc) : undefined;
  }
  const label = localityLabel(key, ctx);
  return label ? ctx.centers.get(label) : undefined;
}

function offlineFallbackMinutes(a: LatLng, b: LatLng, settings: TravelSettings): number {
  const miles = haversineMiles(a, b) * ROAD_CIRCUITY;
  const speed = settings.avgSpeedMph > 0 ? settings.avgSpeedMph : DEFAULT_TRAVEL_SETTINGS.avgSpeedMph;
  return (miles / speed) * 60;
}

// Minutes the BCBA needs to travel from a session at `fromKey` to one at `toKey`,
// departing at `departureMs`. Returns the value AND a source flag (for UI honesty).
export function computeTravel(
  fromKey: LocKey, toKey: LocKey, departureMs: number, ctx: TravelContext,
): TravelEstimate {
  if (fromKey === toKey) return { minutes: 0, source: 'same' };

  const fromLoc = localityLabel(fromKey, ctx);
  const toLoc = localityLabel(toKey, ctx);
  // Missing city on either side → don't over-constrain; no travel requirement.
  if (fromLoc === undefined || toLoc === undefined) return { minutes: 0, source: 'unknown' };

  // Two clients in the same city (same label, neither is HOME) → flat floor.
  if (fromLoc === toLoc) {
    return { minutes: Math.round(ctx.settings.withinCityMin), source: 'within-city' };
  }

  // Cross-locality: prefer the real traffic-aware routed duration for this
  // departure bucket. Travel is symmetric enough to accept either direction.
  const dow = dowOf(departureMs);
  const hour = hourBucket(departureMs, ctx.settings.hourBucketSize);
  const routed =
    ctx.cache.get(cacheKey(fromLoc, toLoc, dow, hour)) ??
    ctx.cache.get(cacheKey(toLoc, fromLoc, dow, hour));
  if (routed != null) {
    return { minutes: Math.ceil(routed * (1 + ctx.settings.padPercent / 100)), source: 'routed' };
  }

  // No cached routed time → offline haversine estimate between centroids.
  const a = centroidOf(fromKey, ctx);
  const b = centroidOf(toKey, ctx);
  if (a && b) return { minutes: Math.ceil(offlineFallbackMinutes(a, b, ctx.settings)), source: 'fallback' };

  // Known cities but no centroid at all → conservative default so we still gap.
  return { minutes: Math.round(ctx.settings.defaultUnknownMin), source: 'fallback' };
}

// Thin number-only accessor for the builder hot path.
export function travelMinutes(
  fromKey: LocKey, toKey: LocKey, departureMs: number, ctx: TravelContext,
): number {
  if (!ctx.settings.enabled) return 0;
  return computeTravel(fromKey, toKey, departureMs, ctx).minutes;
}

// ── AI hint matrix ─────────────────────────────────────────────────────────
// Client-id-keyed travel minutes at a representative departure time, for every
// ordered pair of clients that share no locality problem. The caller (anonymizer
// / claudeScheduler) tokenizes the ids — city NAMES never enter this map, only
// derived minutes, so nothing identifying reaches Claude.
export function travelMatrixByClientId(
  data: ScheduleData, ctx: TravelContext, representativeDepartureMs: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const ids = data.clients.filter(c => normalizeCity(c.city)).map(c => c.id);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const est = computeTravel(a, b, representativeDepartureMs, ctx);
      if (est.minutes > 0) out.set(`${a}|${b}`, est.minutes);
    }
  }
  return out;
}
