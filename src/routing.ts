// The ONE networked module for travel grounding. Everything else (travel.ts,
// the builder, the AI path) is offline and reads only the caches this fills.
//
// Provider-swappable: `RoutingProvider` abstracts geocoding + a traffic-aware
// travel matrix. The default implementation is Google (Geocoding API + Routes
// API `computeRouteMatrix` with predictive traffic for a future departure time).
//
// HIPAA: only public city centroids + the user's own home coords + departure
// times are ever sent out — never a client name, id, or real address. Error
// messages here deliberately omit the query and key (there is no log scrubber).

import {
  ScheduleData, LatLng, CityCenter, TravelCacheEntry, CompanySettings,
} from './types';
import { normalizeCity, HOME_KEY, travelSettingsOf } from './travel';

export interface RoutingProvider {
  // City name / address → centroid, or null if not found.
  geocode(query: string): Promise<LatLng | null>;
  // Traffic-aware drive minutes for every origin→destination pair, departing at
  // `departure` (must be in the future for predictive traffic). null = no route.
  computeMatrix(origins: LatLng[], destinations: LatLng[], departure: Date): Promise<(number | null)[][]>;
}

// ── Google implementation ────────────────────────────────────────────────────
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

// Google's Geocoding/Routes are server-side APIs that DON'T send CORS headers,
// so a WKWebView `fetch` is blocked on device. On native we route through
// Capacitor's HTTP bridge (a real native request — no CORS); on web/Node we fall
// back to `fetch`. The dynamic import keeps @capacitor/core out of the Node/test
// path, and using CapacitorHttp.request() directly (not the global fetch-patch)
// leaves the Anthropic streaming path on normal fetch, untouched.
async function nativeHttp(): Promise<{ request: (o: any) => Promise<{ status: number; data: any }> } | null> {
  try {
    const core: any = await import('@capacitor/core');
    return core?.Capacitor?.isNativePlatform?.() ? core.CapacitorHttp : null;
  } catch {
    return null;
  }
}

async function httpRequest(
  url: string, method: 'GET' | 'POST', headers?: Record<string, string>, body?: unknown,
): Promise<{ status: number; data: any }> {
  const cap = await nativeHttp();
  if (cap) {
    const res = await cap.request({ url, method, headers, data: body });
    return { status: res.status, data: res.data };
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const ok = (status: number) => status >= 200 && status < 300;

export class GoogleRoutingProvider implements RoutingProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('Google Maps API key is required');
  }

  async geocode(query: string): Promise<LatLng | null> {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${encodeURIComponent(this.apiKey)}`;
    let r: { status: number; data: any };
    try {
      r = await httpRequest(url, 'GET');
    } catch {
      throw new Error('Geocoding request failed (network)');
    }
    if (!ok(r.status)) throw new Error(`Geocoding failed (HTTP ${r.status})`);
    const body = r.data as
      | { status?: string; results?: { geometry?: { location?: { lat: number; lng: number } } }[] }
      | null;
    if (!body || body.status !== 'OK' || !body.results?.length) return null;
    const loc = body.results[0].geometry?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    return { lat: loc.lat, lng: loc.lng };
  }

  async computeMatrix(origins: LatLng[], destinations: LatLng[], departure: Date): Promise<(number | null)[][]> {
    if (!origins.length || !destinations.length) return [];
    const toWaypoint = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
    const body = {
      origins: origins.map(toWaypoint),
      destinations: destinations.map(toWaypoint),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: departure.toISOString(),
    };
    let r: { status: number; data: any };
    try {
      r = await httpRequest(ROUTE_MATRIX_URL, 'POST', {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
      }, body);
    } catch {
      throw new Error('Route matrix request failed (network)');
    }
    if (!ok(r.status)) throw new Error(`Route matrix failed (HTTP ${r.status})`);
    const elements = r.data as
      | { originIndex: number; destinationIndex: number; duration?: string; condition?: string }[]
      | null;
    if (!Array.isArray(elements)) throw new Error('Route matrix returned an unexpected shape');

    const grid: (number | null)[][] = origins.map(() => destinations.map(() => null));
    for (const el of elements) {
      if (el.condition && el.condition !== 'ROUTE_EXISTS') continue;
      const secs = parseDurationSeconds(el.duration);
      if (secs == null) continue;
      if (grid[el.originIndex]) grid[el.originIndex][el.destinationIndex] = secs / 60;
    }
    return grid;
  }
}

// Google durations look like "1234s".
function parseDurationSeconds(d: string | undefined): number | null {
  if (!d) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d.trim());
  return m ? Number(m[1]) : null;
}

// ── pure pre-warm helpers (unit-testable without the network) ────────────────

// A locality the BCBA can be at: a client city or the home base. `label` is the
// travel-cache key ('HOME' or the normalized city); `center` its centroid.
export interface Locality {
  label: string; // 'HOME' | normalized city
  center: LatLng;
}

// Distinct localities with known centroids, derived from client cities + home.
export function distinctLocalities(data: ScheduleData, centers: Map<string, LatLng>): Locality[] {
  const out = new Map<string, LatLng>();
  for (const c of data.clients) {
    const label = normalizeCity(c.city);
    if (label && centers.has(label)) out.set(label, centers.get(label)!);
  }
  const h = data.settings.homeBase;
  if (h) {
    if (Number.isFinite(h.lat) && Number.isFinite(h.lng)) {
      out.set(HOME_KEY, { lat: h.lat as number, lng: h.lng as number });
    } else {
      const hc = normalizeCity(h.city);
      if (hc && centers.has(hc)) out.set(HOME_KEY, centers.get(hc)!);
    }
  }
  return [...out.entries()].map(([label, center]) => ({ label, center }));
}

// The (dow, hour-bucket) departure buckets worth pre-warming: exactly the hours
// the BCBA actually works, read from clinicianAvailability (falls back to a
// Mon–Fri 8–18 business window when unset). Bounding to real work hours keeps
// the API/billing footprint small — nothing is silently dropped beyond this.
export function departureBuckets(settings: CompanySettings): { dow: number; hour: number }[] {
  const bucketSize = travelSettingsOf(settings).hourBucketSize || 1;
  const avail = settings.clinicianAvailability;
  const DOW: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  const seen = new Set<string>();
  const out: { dow: number; hour: number }[] = [];
  const add = (dow: number, hour: number) => {
    const b = Math.floor(hour / bucketSize) * bucketSize;
    const k = `${dow}|${b}`;
    if (!seen.has(k)) { seen.add(k); out.push({ dow, hour: b }); }
  };
  const hasWindows = avail && Object.values(avail).some(w => (w?.length ?? 0) > 0);
  if (hasWindows) {
    for (const [day, windows] of Object.entries(avail!)) {
      const dow = DOW[day];
      for (const w of windows || []) {
        const startH = parseInt(w.start.slice(0, 2), 10);
        const endH = parseInt(w.end.slice(0, 2), 10);
        for (let h = startH; h <= endH; h++) add(dow, h);
      }
    }
  } else {
    for (let dow = 1; dow <= 5; dow++) for (let h = 8; h <= 18; h++) add(dow, h);
  }
  return out;
}

// Smallest future timestamp whose local weekday === dow and local hour === hour.
// Google's predictive traffic requires a future departureTime.
export function nextFutureDate(dow: number, hour: number, now: Date): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  let guard = 0;
  while ((d.getDay() !== dow || d.getTime() <= now.getTime()) && guard < 21) {
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    guard++;
  }
  return d;
}

export interface RefreshResult {
  cityCenters: CityCenter[];
  travelCache: TravelCacheEntry[];
  log: string[];
}

// Orchestrate a full refresh: geocode any missing city centroids + the home
// address, then fill the routed-duration cache for every locality pair across
// the working departure buckets. Idempotent — reuses existing centroids. Pure of
// wall-clock via the injected `now`. Returns merged caches to persist into settings.
export async function refreshTravelTimes(
  data: ScheduleData, provider: RoutingProvider, now: Date,
): Promise<RefreshResult> {
  const log: string[] = [];
  const centers = new Map<string, LatLng>();
  for (const cc of data.settings.cityCenters || []) {
    const label = normalizeCity(cc.city);
    if (label) centers.set(label, { lat: cc.lat, lng: cc.lng });
  }

  // 1) Geocode any client city lacking a centroid.
  const wantedCities = new Map<string, string>(); // normalized → original (as entered)
  for (const c of data.clients) {
    const label = normalizeCity(c.city);
    if (label && !wantedCities.has(label)) wantedCities.set(label, (c.city || '').trim());
  }
  const h = data.settings.homeBase;
  if (h?.city) {
    const label = normalizeCity(h.city);
    if (label && !wantedCities.has(label)) wantedCities.set(label, h.city.trim());
  }
  for (const [label, original] of wantedCities) {
    if (centers.has(label)) continue;
    const g = await provider.geocode(original);
    if (g) { centers.set(label, g); log.push(`Geocoded a city centroid.`); }
    else log.push(`A city could not be geocoded; it will use the offline fallback.`);
  }

  // 2) Home base coords: prefer an exact address geocode when coords are unset.
  let homeCenter: LatLng | undefined;
  if (h) {
    if (Number.isFinite(h.lat) && Number.isFinite(h.lng)) {
      homeCenter = { lat: h.lat as number, lng: h.lng as number };
    } else if (h.address) {
      const g = await provider.geocode(h.address);
      if (g) { homeCenter = g; log.push('Geocoded the home base address.'); }
    } else if (h.city) {
      homeCenter = centers.get(normalizeCity(h.city)!);
    }
  }

  const cityCenters: CityCenter[] = [...centers.entries()].map(([label, c]) => ({ city: label, lat: c.lat, lng: c.lng }));

  // 3) Build the locality list (cities + HOME) and warm the routed cache.
  const localities: Locality[] = [...centers.entries()].map(([label, center]) => ({ label, center }));
  if (homeCenter) localities.push({ label: HOME_KEY, center: homeCenter });

  const travelCache: TravelCacheEntry[] = [];
  if (localities.length >= 2) {
    const buckets = departureBuckets(data.settings);
    log.push(`Warming ${localities.length} localities × ${buckets.length} time buckets.`);
    const points = localities.map(l => l.center);
    for (const b of buckets) {
      const depart = nextFutureDate(b.dow, b.hour, now);
      let grid: (number | null)[][];
      try {
        grid = await provider.computeMatrix(points, points, depart);
      } catch {
        log.push(`A route-matrix call failed for one bucket; those pairs use the offline fallback.`);
        continue;
      }
      for (let i = 0; i < localities.length; i++) {
        for (let j = 0; j < localities.length; j++) {
          if (i === j) continue;
          const minutes = grid[i]?.[j];
          if (minutes != null && Number.isFinite(minutes)) {
            travelCache.push({ from: localities[i].label, to: localities[j].label, dow: b.dow, hour: b.hour, minutes });
          }
        }
      }
    }
  } else {
    log.push('Not enough located sites to warm travel times yet.');
  }

  return { cityCenters, travelCache, log };
}
