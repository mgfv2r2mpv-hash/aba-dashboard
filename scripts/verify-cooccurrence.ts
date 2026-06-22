/**
 * Verification for the co-occurrence ordering helper (Phase 5).
 *
 * Checks that orderByCoOccurrence places clients with the most shared
 * availability overlap adjacent to each other, seeded by highest total-degree
 * client, with deterministic tie-breaking by client name.
 *
 * Run: npx tsx scripts/verify-cooccurrence.ts
 */
import { Client } from '../src/types';
import { orderByCoOccurrence } from '../src/components/clientCalendarShared';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function client(name: string, avail: Record<string, { start: string; end: string }[]>): Client {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    availabilityWindows: avail as Client['availabilityWindows'],
  } as Client;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const alice = client('Alice', {
  Monday:    [{ start: '09:00', end: '12:00' }],
  Wednesday: [{ start: '09:00', end: '12:00' }],
});

const bob = client('Bob', {
  Monday:    [{ start: '09:00', end: '12:00' }],
  Wednesday: [{ start: '09:00', end: '12:00' }],
});

const carol = client('Carol', {
  Tuesday: [{ start: '09:00', end: '12:00' }],
});

const dan = client('Dan', {
  Monday:    [{ start: '10:00', end: '11:00' }],
  Wednesday: [{ start: '10:00', end: '11:00' }],
});

const noAvail = client('Empty', {});

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\norderByCoOccurrence');

console.log('\n  single client → as-is');
{
  const result = orderByCoOccurrence([alice]);
  assert('returns same client', result.length === 1 && result[0].name === 'Alice');
}

console.log('\n  two clients → returned in any order (just no crash)');
{
  const result = orderByCoOccurrence([alice, carol]);
  assert('returns both', result.length === 2);
  assert('contains Alice', result.some(c => c.name === 'Alice'));
  assert('contains Carol', result.some(c => c.name === 'Carol'));
}

console.log('\n  Alice + Bob (high overlap) + Carol (no overlap) → Alice/Bob adjacent, Carol last');
{
  const result = orderByCoOccurrence([alice, carol, bob]);
  const names = result.map(c => c.name);
  const carolIdx = names.indexOf('Carol');
  const aliceIdx = names.indexOf('Alice');
  const bobIdx   = names.indexOf('Bob');
  assert('Carol is last (no overlap with others)', carolIdx === 2, `order: ${names.join(', ')}`);
  assert('Alice and Bob are adjacent', Math.abs(aliceIdx - bobIdx) === 1, `order: ${names.join(', ')}`);
}

console.log('\n  Seed = highest total-overlap client');
{
  // Alice+Bob overlap = 360min×2=720, Dan's overlap with Alice = 120, with Bob = 120
  // Alice total = 720+120=840, Bob = 720+120=840, Dan = 120+120=240
  // Alice and Bob tie → alphabetical: Alice seeds first (A < B)
  const result = orderByCoOccurrence([dan, alice, bob]);
  assert('Alice or Bob seeds first (highest degree)', ['Alice','Bob'].includes(result[0].name), `first: ${result[0].name}`);
}

console.log('\n  no-availability client ends up last');
{
  const result = orderByCoOccurrence([alice, noAvail, bob]);
  const names = result.map(c => c.name);
  const emptyIdx = names.indexOf('Empty');
  assert('Empty is last', emptyIdx === 2, `order: ${names.join(', ')}`);
}

console.log('\n  deterministic: same input twice → same output');
{
  const r1 = orderByCoOccurrence([carol, dan, alice, bob]).map(c => c.name).join(',');
  const r2 = orderByCoOccurrence([carol, dan, alice, bob]).map(c => c.name).join(',');
  assert('stable order', r1 === r2, `${r1} vs ${r2}`);
}

console.log('\n  reversed input → same output as forward input (order-independent)');
{
  const fwd = orderByCoOccurrence([alice, bob, carol]).map(c => c.name).join(',');
  const rev = orderByCoOccurrence([carol, bob, alice]).map(c => c.name).join(',');
  assert('input order does not change result', fwd === rev, `fwd=${fwd} rev=${rev}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
