// The proxy's own gates, and the one test that matters most: the exact request
// ClaudeScheduler puts on the wire is run through both of them.
//
// The proxy cannot re-check names - it never learns them. It checks the SHAPE the
// anonymizer promises, so the two halves have to agree about what that shape is.
// A field added to messages.create, or an id that reaches the payload unmapped,
// breaks that agreement here rather than at Anthropic.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeScheduler } from '@shared/claudeScheduler';
import type { ScheduleData } from '@shared/types';
import { findPhiShape, findRequestFault, isRateLimited, identify } from '../../functions/api/claude/v1/messages';

const data: ScheduleData = {
  id: 'sched-1', version: 2,
  clients: [{ id: '6f1c0e2a-1111-4222-8333-444455556666', name: 'Zebra Quill', availabilityWindows: {} }],
  technicians: [{
    id: '7a2d1f3b-1111-4222-8333-444455556666', name: 'Yak Riddle', isRBT: true,
    assignments: [{ clientId: '6f1c0e2a-1111-4222-8333-444455556666', hoursPerWeek: 10, billable: true }],
    availability: {},
  }],
  settings: {
    supervisionDirectHoursPercent: 15, supervisionRBTHoursPercent: 5,
    parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
  } as ScheduleData['settings'],
  appointments: [{
    id: '8b3e2c4d-1111-4222-8333-444455556666', title: 'Session',
    client: '6f1c0e2a-1111-4222-8333-444455556666', technician: '7a2d1f3b-1111-4222-8333-444455556666',
    startTime: '2026-09-10T13:00:00', endTime: '2026-09-10T15:00:00',
    isFixed: false, isBillable: true, type: 'client-session',
  }],
  blackouts: [{ id: 'b1', entityType: 'client', entityId: '6f1c0e2a-1111-4222-8333-444455556666', date: '2026-09-14', reason: 'dentist' }],
  lastModified: '2026-07-01T00:00:00.000Z',
};

const TOOL_REPLY = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
  content: [{ type: 'tool_use', id: 'tu_1', name: 'respond', input: { reply: 'ok', ops: [] } }],
  stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
};

describe('findPhiShape - what token space never contains', () => {
  it('catches a raw uuid, which is what an unmapped id looks like', () => {
    expect(findPhiShape('{"client":"6f1c0e2a-1111-4222-8333-444455556666"}')).toBe('uuid');
  });

  it('catches an email address, a phone number and an SSN', () => {
    expect(findPhiShape('reach the parent at kai.parent@example.com')).toBe('email address');
    expect(findPhiShape('call 617-555-0142 first')).toBe('phone number');
    expect(findPhiShape('member 078-05-1120')).toBe('social security number');
  });

  it('passes ordinary token-space content, including ISO datetimes and dates', () => {
    expect(findPhiShape('CLIENT_1 APT_3 2026-09-01T14:00:00 through 2026-09-01T16:00:00, 15% of 20.5h')).toBeNull();
  });
});

describe('findRequestFault - the request the proxy will forward', () => {
  const valid = { model: 'claude-sonnet-4-6', max_tokens: 8000, messages: [{ role: 'user', content: 'hi' }] };

  it('accepts a well-formed request', () => {
    expect(findRequestFault(valid)).toBeNull();
  });

  it('refuses a field that is not on the allowlist', () => {
    expect(findRequestFault({ ...valid, schedule: { clients: [] } })).toContain('"schedule"');
  });

  it('refuses a model the portal does not offer', () => {
    expect(findRequestFault({ ...valid, model: 'gpt-9' })).toContain('model');
  });

  it('refuses a max_tokens above the cap, and a missing one', () => {
    expect(findRequestFault({ ...valid, max_tokens: 100000 })).toContain('max_tokens');
    expect(findRequestFault({ model: valid.model, messages: valid.messages })).toContain('max_tokens');
  });

  it('refuses an empty conversation and an unknown role', () => {
    expect(findRequestFault({ ...valid, messages: [] })).toContain('at least one message');
    expect(findRequestFault({ ...valid, messages: [{ role: 'system', content: 'x' }] })).toContain('user or the assistant');
  });
});

describe('isRateLimited - one identity, one window', () => {
  it('allows a burst and then refuses, and forgets once the window passes', () => {
    const calls = new Map<string, number[]>();
    const at = 1_000_000;
    const allowed = Array.from({ length: 15 }, () => isRateLimited('bcba@example.com', at, calls));
    expect(allowed.every(blocked => blocked === false)).toBe(true);
    expect(isRateLimited('bcba@example.com', at, calls)).toBe(true);
    expect(isRateLimited('someone.else@example.com', at, calls)).toBe(false);
    expect(isRateLimited('bcba@example.com', at + 60_001, calls)).toBe(false);
  });
});

describe('identify - whose bucket a proxied call is charged to', () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request('https://sassi.nooutco.me/api/claude/v1/messages', { headers });

  it('ignores a Cf-Access header the client supplied itself', () => {
    // The whole reason this function stopped reading headers. Cloudflare strips a
    // client-supplied copy only while Access is in front of the origin, and app
    // login is precisely the change that takes it out of the way.
    const spoofed = withHeaders({
      'Cf-Access-Authenticated-User-Email': 'boss@clinic.org',
      'CF-Connecting-IP': '203.0.113.9',
    });
    expect(identify(spoofed)).toBe('ip:203.0.113.9');
    expect(identify(spoofed)).not.toContain('boss@clinic.org');
  });

  it('charges the portal account when there is a session', () => {
    const id = identify(withHeaders({ 'CF-Connecting-IP': '203.0.113.9' }), {
      accessEmail: 'boss@clinic.org', sessionUserId: 'u-1',
    });
    expect(id).toBe('user:u-1');
  });

  it('falls back to the verified Access email, then to the IP', () => {
    const request = withHeaders({ 'CF-Connecting-IP': '203.0.113.9' });
    expect(identify(request, { accessEmail: 'boss@clinic.org', sessionUserId: null }))
      .toBe('access:boss@clinic.org');
    expect(identify(request, { accessEmail: null, sessionUserId: null }))
      .toBe('ip:203.0.113.9');
  });

  it('keeps two signed-in people in separate buckets behind one office IP', () => {
    // The failure this replaces: with Access relaxed, the old identify() found no
    // header on anybody and returned the literal 'unknown' for every caller, so one
    // busy user spent everyone else's fifteen calls a minute.
    const at = 1_000_000;
    const calls = new Map<string, number[]>();
    const office = withHeaders({ 'CF-Connecting-IP': '203.0.113.9' });
    const one = identify(office, { accessEmail: null, sessionUserId: 'u-1' });
    const two = identify(office, { accessEmail: null, sessionUserId: 'u-2' });

    Array.from({ length: 15 }, () => isRateLimited(one, at, calls));
    expect(isRateLimited(one, at, calls)).toBe(true);
    expect(isRateLimited(two, at, calls)).toBe(false);
  });
});

describe('the request ClaudeScheduler actually sends passes both gates', () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; body: any } | null = null;

  // The prompt carries only sessions inside the current month, so the clock is
  // pinned to one that contains the fixture. Without this the schedule section is
  // empty and every assertion about what it carries passes without being tested.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T09:00:00'));
  });
  afterAll(() => { vi.useRealTimers(); });

  beforeEach(() => {
    sent = null;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      sent = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify(TOOL_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('posts to the same-origin proxy, not to Anthropic', async () => {
    const scheduler = new ClaudeScheduler('unused-by-the-proxy', data, 'claude-sonnet-4-6', 'http://portal.test/api/claude');
    await scheduler.chat([{ role: 'user', content: 'what does my week look like' }]);
    expect(sent!.url).toBe('http://portal.test/api/claude/v1/messages');
  });

  it('sends only allowlisted fields, and nothing PHI-shaped', async () => {
    const scheduler = new ClaudeScheduler('unused-by-the-proxy', data, 'claude-sonnet-4-6', 'http://portal.test/api/claude');
    await scheduler.chat([{ role: 'user', content: 'fill my week to 25 hours' }]);

    expect(findRequestFault(sent!.body)).toBeNull();
    expect(findPhiShape(JSON.stringify(sent!.body))).toBeNull();
  });

  it('carries no client id, technician id or appointment id from the real schedule', async () => {
    const scheduler = new ClaudeScheduler('unused-by-the-proxy', data, 'claude-sonnet-4-6', 'http://portal.test/api/claude');
    await scheduler.chat([{ role: 'user', content: 'add supervision on the fifth' }]);

    const wire = JSON.stringify(sent!.body);
    // The session is on the wire (as a token) - otherwise the three assertions
    // below would hold for a payload that simply never mentioned it.
    expect(wire).toContain('APT_1');
    expect(wire).toContain('2026-09-10T13:00:00');
    expect(wire).not.toContain(data.clients[0].id);
    expect(wire).not.toContain(data.technicians[0].id);
    expect(wire).not.toContain(data.appointments[0].id);
    expect(wire).not.toContain('Zebra Quill');
  });
});
