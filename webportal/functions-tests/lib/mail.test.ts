// Mail is the one part of this system that leaves the machine, so it gets its own
// tests rather than being covered incidentally by the endpoint that uses it.
//
// The rule these are protecting: a send NEVER throws. By the time the caller reaches
// the mailer it has already written a new password hash to the store - it cannot know
// what to send before it decides what the password is - so an exception here would
// leave an account holding a password nobody has. Every failure has to come back as a
// value the caller can hand to the admin instead.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resendMailer, mailerFor, tempPasswordMessage } from '../../functions/lib/mail';
import type { PortalEnv } from '../../functions/lib/env';

const MESSAGE = { to: 'bt@clinic.org', subject: 'Your sign-in', text: 'the body' };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A fetch that answers however the test says, and records what it was handed. */
function stubFetch(answer: FetchLike) {
  const spy = vi.fn<FetchLike>(answer);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** The body Resend sent back, off whichever call the test cares about. */
function bodyOf(spy: ReturnType<typeof stubFetch>, call = 0): Record<string, unknown> {
  return JSON.parse(spy.mock.calls[call][1].body as string);
}

const ok: FetchLike = async () =>
  ({ ok: true, status: 200, json: async () => ({ id: 'abc' }) } as unknown as Response);

afterEach(() => { vi.unstubAllGlobals(); });

describe('sending through Resend', () => {
  it('posts the message to Resend, authenticated, as JSON', async () => {
    const spy = stubFetch(ok);
    await resendMailer('re_test_key', 'SAssi <sassi@nooutco.me>').send(MESSAGE);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');
    expect(bodyOf(spy)).toEqual({
      from: 'SAssi <sassi@nooutco.me>',
      to: ['bt@clinic.org'],
      subject: 'Your sign-in',
      text: 'the body',
    });
  });

  it('reports success as a value', async () => {
    stubFetch(ok);
    await expect(resendMailer('k', 'f').send(MESSAGE)).resolves.toEqual({ ok: true });
  });

  it('gives back the sentence Resend wrote, not the status code', async () => {
    // An admin reading "status 422" learns nothing. Resend's own message names the
    // cause - an unverified domain, a malformed address - and those are all things
    // they can act on once they can read them.
    stubFetch(async () => ({
      ok: false, status: 422,
      json: async () => ({ message: 'The nooutco.me domain is not verified.' }),
    } as unknown as Response));

    await expect(resendMailer('k', 'f').send(MESSAGE)).resolves.toEqual({
      ok: false, reason: 'The nooutco.me domain is not verified.',
    });
  });

  it('falls back to the status when the error body is not JSON', async () => {
    stubFetch(async () => ({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    } as unknown as Response));

    await expect(resendMailer('k', 'f').send(MESSAGE)).resolves.toEqual({
      ok: false, reason: 'status 502',
    });
  });

  it('turns a network failure into a value rather than throwing', async () => {
    // The assertion the whole module exists for.
    stubFetch(() => { throw new TypeError('Failed to fetch'); });
    const result = await resendMailer('k', 'f').send(MESSAGE);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/Could not reach the mail service/);
  });
});

describe('whether this deployment can send at all', () => {
  it('has no mailer when no key is bound', () => {
    // Secrets attach at deploy time, so a deployment made before the key was added
    // has none. That has to read as "not configured", never as a silent no-op.
    expect(mailerFor({} as PortalEnv)).toBeNull();
    expect(mailerFor({ RESEND_API_KEY: '' } as PortalEnv)).toBeNull();
  });

  it('sends from the verified domain by default', async () => {
    const spy = stubFetch(ok);
    await mailerFor({ RESEND_API_KEY: 'k' } as PortalEnv)!.send(MESSAGE);
    expect(bodyOf(spy).from).toBe('SAssi Scheduler <sassi@nooutco.me>');
  });

  it('lets a project setting override the from address', async () => {
    const spy = stubFetch(ok);
    await mailerFor({ RESEND_API_KEY: 'k', PORTAL_MAIL_FROM: 'Scheduler <no-reply@nooutco.me>' } as PortalEnv)!
      .send(MESSAGE);
    expect(bodyOf(spy).from).toBe('Scheduler <no-reply@nooutco.me>');
  });
});

describe('the invitation itself', () => {
  const written = tempPasswordMessage('https://sassi.nooutco.me', 'ABCD2345EFGH');

  it('carries the password and the place to use it', () => {
    expect(written.text).toContain('ABCD2345EFGH');
    expect(written.text).toContain('https://sassi.nooutco.me');
  });

  it('says the password is spent on arrival, so nobody keeps the email', () => {
    expect(written.text).toMatch(/stops working/);
  });

  it('names nobody being served', () => {
    // This is the one message that lands somewhere nobody here controls. It says who
    // it is from and what to do; it carries nothing about any person being served.
    const words = (written.text + ' ' + written.subject).toLowerCase();
    for (const forbidden of ['client', 'patient', 'appointment', 'diagnosis', 'hours'])
      expect(words).not.toContain(forbidden);
  });

  it('mentions scheduling only as the name of the product', () => {
    // Split out from the check above because the product is called SAssi Scheduler,
    // so the bare word cannot be banned - what must not appear is a schedule
    // belonging to somebody.
    const withoutProductName = (written.text + ' ' + written.subject)
      .replace(/SAssi Scheduler/g, '')
      .replace(/scheduler/gi, '')
      .toLowerCase();
    expect(withoutProductName).not.toContain('schedul');
  });
});
