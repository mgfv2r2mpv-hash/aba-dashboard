/**
 * Verification for the BCBA travel-time model (src/travel.ts) and the pure
 * pre-warm helpers of the routing layer (src/routing.ts).
 * Run: npx tsx scripts/verify-travel.ts
 *
 * No live network: a MockRoutingProvider stands in for Google so the model,
 * cache lookups, time-bucket selection, and offline fallback are all exercised
 * deterministically.
 */
import { ScheduleData, CompanySettings, Client, WishOp, DEFAULT_TRAVEL_SETTINGS } from '../src/types';
import { buildTravelContext, computeTravel, travelMinutes, HOME_KEY } from '../src/travel';
import { RoutingProvider, distinctLocalities, departureBuckets, nextFutureDate, refreshTravelTimes } from '../src/routing';
import { placeBcbaSubinterval, DatedDirect } from '../src/builderBcba';
import { dropInfeasibleTravelOps } from '../src/wish';
import { LatLng } from '../src/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const client = (id: string, city?: string): Client => ({ id, name: id, availabilityWindows: {}, ...(city ? { city } : {}) });

// A Tuesday 10:00 and 17:00 (local); 2026-07-07 is a Tuesday.
const TUE_10 = new Date('2026-07-07T10:00:00').getTime();
const TUE_17 = new Date('2026-07-07T17:00:00').getTime();
const WED_10 = new Date('2026-07-08T10:00:00').getTime(); // no cache entry → fallback

function baseSettings(): CompanySettings {
  return {
    supervisionDirectHoursPercent: 20,
    supervisionRBTHoursPercent: 5,
    parentTraining: { minimumHours: 1, targetMinHours: 1, targetMaxHours: 2, periodUnit: 'month' },
    travel: { ...DEFAULT_TRAVEL_SETTINGS },
    homeBase: { city: 'Hometown', lat: 40.0, lng: -75.0 },
    cityCenters: [
      { city: 'springfield', lat: 40.1, lng: -75.1 },
      { city: 'shelbyville', lat: 41.0, lng: -76.0 },
      { city: 'hometown', lat: 40.0, lng: -75.0 },
    ],
    travelCache: [
      { from: 'springfield', to: 'shelbyville', dow: 2, hour: 10, minutes: 40 },
      { from: 'springfield', to: 'shelbyville', dow: 2, hour: 17, minutes: 60 },
      { from: 'HOME', to: 'springfield', dow: 2, hour: 10, minutes: 20 },
    ],
  };
}

function scheduleWith(settings: CompanySettings): ScheduleData {
  return {
    id: 's', version: 2,
    clients: [client('A', 'Springfield'), client('B', 'springfield'), client('C', 'Shelbyville'), client('D')],
    technicians: [], settings, appointments: [], lastModified: '2026-07-06T00:00:00',
  };
}

console.log('travel model — core cases');
{
  const ctx = buildTravelContext(scheduleWith(baseSettings()));

  check('same key → 0 (already on site)', computeTravel('A', 'A', TUE_10, ctx).minutes === 0);
  const neutral = computeTravel('A', 'D', TUE_10, ctx);
  check('client with no city → 0, flagged unknown', neutral.minutes === 0 && neutral.source === 'unknown');
  const undef = computeTravel('A', undefined, TUE_10, ctx);
  check('location-neutral key → 0', undef.minutes === 0 && undef.source === 'unknown');

  const within = computeTravel('A', 'B', TUE_10, ctx);
  check('two clients in one city → flat 15 floor', within.minutes === 15 && within.source === 'within-city');

  const routed = computeTravel('A', 'C', TUE_10, ctx);
  check('cross-city routed 40 → 40×1.05 = 42, source routed', routed.minutes === 42 && routed.source === 'routed', `got ${routed.minutes}/${routed.source}`);

  const routedPm = computeTravel('A', 'C', TUE_17, ctx);
  check('time-bucket selection: 17:00 uses 60 → 63', routedPm.minutes === 63 && routedPm.source === 'routed', `got ${routedPm.minutes}`);

  const symmetric = computeTravel('C', 'A', TUE_10, ctx);
  check('cache is symmetric (C→A finds springfield↔shelbyville) → 42', symmetric.minutes === 42, `got ${symmetric.minutes}`);

  const fallback = computeTravel('A', 'C', WED_10, ctx);
  check('cache miss → offline fallback, minutes > 0', fallback.source === 'fallback' && fallback.minutes > 0, `got ${fallback.minutes}/${fallback.source}`);

  const home = computeTravel(HOME_KEY, 'A', TUE_10, ctx);
  check('HOME → client A routed 20 → 21', home.minutes === 21, `got ${home.minutes}`);
}

console.log('travel model — enabled flag');
{
  const s = baseSettings();
  s.travel = { ...DEFAULT_TRAVEL_SETTINGS, enabled: false };
  const ctx = buildTravelContext(scheduleWith(s));
  check('travelMinutes short-circuits to 0 when disabled', travelMinutes('A', 'C', TUE_10, ctx) === 0);
  check('travelMinutes returns routed value when enabled', travelMinutes('A', 'C', TUE_10, buildTravelContext(scheduleWith(baseSettings()))) === 42);
}

console.log('routing helpers — pure');
{
  const s = baseSettings();
  s.clinicianAvailability = { Tuesday: [{ start: '09:00', end: '11:00' }] };
  const buckets = departureBuckets(s);
  check('departureBuckets reads clinician availability (Tue 9–11 → 3 buckets)', buckets.length === 3 && buckets.every(b => b.dow === 2));
  check('departureBuckets includes hour 10', buckets.some(b => b.hour === 10));

  const centers = new Map<string, LatLng>([
    ['springfield', { lat: 40.1, lng: -75.1 }],
    ['shelbyville', { lat: 41.0, lng: -76.0 }],
  ]);
  const locs = distinctLocalities(scheduleWith(baseSettings()), centers);
  check('distinctLocalities → springfield, shelbyville, HOME', locs.length === 3 && locs.some(l => l.label === HOME_KEY));

  const now = new Date('2026-07-06T08:00:00'); // a Monday
  const nd = nextFutureDate(2, 10, now);
  check('nextFutureDate returns a future Tuesday 10:00', nd.getDay() === 2 && nd.getHours() === 10 && nd.getTime() > now.getTime());
}

console.log('builder integration — placeBcbaSubinterval honors the travel gap');
{
  const s = baseSettings();
  s.clinicianAvailability = { Tuesday: [{ start: '08:00', end: '20:00' }] };
  const data = scheduleWith(s); // A=Springfield, C=Shelbyville; cache springfield↔shelbyville@(2,10)=40 → 42
  const ctx = buildTravelContext(data);

  // A BCBA block at client A (Springfield) 10:00–10:30, then a direct at client C
  // (Shelbyville) 10:30–12:00. The supervision sub-slot for C must not start until
  // there's ≥ 42 min (40×1.05) travel after leaving A → earliest 11:12.
  const busyAtA = [{ s: new Date('2026-07-07T10:00:00').getTime(), e: new Date('2026-07-07T10:30:00').getTime(), loc: 'A' }];
  const directC: DatedDirect = {
    clientId: 'C', clientName: 'CC',
    startMs: new Date('2026-07-07T10:30:00').getTime(), endMs: new Date('2026-07-07T12:00:00').getTime(),
    hours: 1.5, weekIndex: 0, materialized: true,
  };

  const withTravel = placeBcbaSubinterval(data, directC, 0.5, busyAtA, ctx);
  const expected = new Date('2026-07-07T11:12:00').getTime();
  check('cross-city supervision is pushed past the 42-min travel gap (→ 11:12)', !!withTravel && withTravel.startMs === expected, withTravel ? new Date(withTravel.startMs).toTimeString().slice(0, 5) : 'null');

  const noTravel = placeBcbaSubinterval(data, directC, 0.5, busyAtA); // ctx omitted → teleport allowed
  const touching = new Date('2026-07-07T10:30:00').getTime();
  check('without travel ctx, slot may abut the prior session (→ 10:30)', !!noTravel && noTravel.startMs === touching);

  // Same-city block imposes only the flat 15-min within-city floor, not routing.
  const busyAtB = [{ s: new Date('2026-07-07T10:00:00').getTime(), e: new Date('2026-07-07T10:30:00').getTime(), loc: 'B' }];
  const directA: DatedDirect = { ...directC, clientId: 'A', clientName: 'AA' };
  const sameCity = placeBcbaSubinterval(data, directA, 0.5, busyAtB, ctx); // B & A both Springfield
  const plus15 = new Date('2026-07-07T10:45:00').getTime();
  check('same-city block imposes the 15-min floor (→ 10:45)', !!sameCity && sameCity.startMs === plus15, sameCity ? new Date(sameCity.startMs).toTimeString().slice(0, 5) : 'null');
}

console.log('AI backstop — dropInfeasibleTravelOps');
{
  const data: ScheduleData = {
    ...scheduleWith(baseSettings()),
    appointments: [{
      id: 'ap-sup-A', title: 'Sup', client: 'A', technician: 'T1',
      startTime: '2026-07-07T10:00:00', endTime: '2026-07-07T10:30:00',
      isFixed: false, isBillable: true, type: 'supervision', status: 'scheduled',
    }],
  };
  const tooClose: WishOp[] = [{ op: 'add', type: 'supervision', client: 'C', start: '2026-07-07T10:45:00', end: '2026-07-07T11:00:00' }];
  check('infeasible cross-city add (15 min gap < 42) is dropped', dropInfeasibleTravelOps(tooClose, data).length === 0);

  const farEnough: WishOp[] = [{ op: 'add', type: 'supervision', client: 'C', start: '2026-07-07T11:30:00', end: '2026-07-07T12:00:00' }];
  check('feasible cross-city add (60 min ≥ 42) is kept', dropInfeasibleTravelOps(farEnough, data).length === 1);

  const direct: WishOp[] = [{ op: 'add', type: 'client-session', client: 'C', technician: 'T1', start: '2026-07-07T10:45:00', end: '2026-07-07T11:00:00' }];
  check('non-BCBA (direct) op always passes through', dropInfeasibleTravelOps(direct, data).length === 1);
}

console.log('routing — refresh with mock provider (no network)');
{
  class MockProvider implements RoutingProvider {
    geocodes = 0; matrixCalls = 0;
    async geocode(_q: string): Promise<LatLng | null> { this.geocodes++; return { lat: 42 + this.geocodes * 0.01, lng: -71 }; }
    async computeMatrix(origins: LatLng[], dests: LatLng[]): Promise<(number | null)[][]> {
      this.matrixCalls++;
      return origins.map((_, i) => dests.map((_, j) => (i === j ? 0 : 30)));
    }
  }
  const s = baseSettings();
  s.cityCenters = []; // force geocoding
  s.clinicianAvailability = { Tuesday: [{ start: '10:00', end: '10:00' }] }; // one bucket
  const data = scheduleWith(s);
  const mock = new MockProvider();
  const now = new Date('2026-07-06T08:00:00');

  refreshTravelTimes(data, mock, now).then(res => {
    check('refresh geocoded the missing city centroids', res.cityCenters.length >= 2 && mock.geocodes >= 2);
    check('refresh warmed a routed cache (30-min mock durations)', res.travelCache.length > 0 && res.travelCache.every(e => e.minutes === 30));
    check('refresh emitted a human log', res.log.length > 0);

    // Feed the refreshed caches back and confirm the model reads them (30 → 32).
    const s2 = { ...baseSettings(), cityCenters: res.cityCenters, travelCache: res.travelCache };
    const ctx2 = buildTravelContext(scheduleWith(s2));
    const est = computeTravel('A', 'C', TUE_10, ctx2);
    check('model reads refreshed cache: 30×1.05 = 32', est.minutes === 32 && est.source === 'routed', `got ${est.minutes}/${est.source}`);

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }).catch(e => { console.error(e); process.exit(1); });
}
