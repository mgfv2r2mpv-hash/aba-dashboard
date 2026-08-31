import { describe, it, expect } from 'vitest';
import { decideGate, isApiPath, isSelfAuthorizingApiPath } from './gate';

const base = { storeConfigured: true, hasAccessIdentity: false, hasPortalSession: false };

describe('isApiPath', () => {
  it.each(['/api', '/api/', '/api/auth/login', '/api/claude/v1/messages'])(
    'calls %s an API path', (p) => expect(isApiPath(p)).toBe(true),
  );
  it.each(['/', '/index.html', '/assets/index-abc.js', '/apiary', '/x/api/y'])(
    'calls %s not an API path', (p) => expect(isApiPath(p)).toBe(false),
  );
});

describe('isSelfAuthorizingApiPath', () => {
  it.each(['/api/auth/login', '/api/auth/session', '/api/admin/users'])(
    '%s authorizes itself', (p) => expect(isSelfAuthorizingApiPath(p)).toBe(true),
  );
  it.each(['/api/claude/v1/messages', '/api/schedules', '/api/'])(
    '%s does not', (p) => expect(isSelfAuthorizingApiPath(p)).toBe(false),
  );
});

describe('before the login store is configured', () => {
  const unconfigured = { ...base, storeConfigured: false };

  it('behaves exactly as the site always has: Access gates everything', () => {
    for (const pathname of ['/', '/assets/app.js', '/api/auth/login', '/api/claude/v1/messages']) {
      expect(decideGate({ ...unconfigured, pathname })).toEqual({ kind: 'needs-access' });
      expect(decideGate({ ...unconfigured, pathname, hasAccessIdentity: true })).toEqual({ kind: 'serve' });
    }
  });

  it('ignores a portal session entirely, since there is no store to have issued one', () => {
    expect(decideGate({ ...unconfigured, pathname: '/', hasPortalSession: true }))
      .toEqual({ kind: 'needs-access' });
  });
});

describe('once the login store is configured', () => {
  it('serves the page shell to anyone, so a login screen can render', () => {
    for (const pathname of ['/', '/index.html', '/assets/index-abc.js', '/favicon.ico']) {
      expect(decideGate({ ...base, pathname })).toEqual({ kind: 'serve' });
    }
  });

  it('serves the auth and admin endpoints, which authorize themselves', () => {
    for (const pathname of ['/api/auth/login', '/api/auth/session', '/api/admin/users']) {
      expect(decideGate({ ...base, pathname })).toEqual({ kind: 'serve' });
    }
  });

  it('demands a portal session for every other API route', () => {
    expect(decideGate({ ...base, pathname: '/api/claude/v1/messages' }))
      .toEqual({ kind: 'needs-session' });
    expect(decideGate({ ...base, pathname: '/api/claude/v1/messages', hasPortalSession: true }))
      .toEqual({ kind: 'serve' });
  });

  it('does not let an Access identity substitute for a session on a gated route', () => {
    expect(decideGate({ ...base, pathname: '/api/claude/v1/messages', hasAccessIdentity: true }))
      .toEqual({ kind: 'needs-session' });
  });

  it('never answers needs-access once the store is configured', () => {
    for (const pathname of ['/', '/api/auth/login', '/api/claude/v1/messages']) {
      for (const hasAccessIdentity of [true, false]) {
        for (const hasPortalSession of [true, false]) {
          expect(decideGate({ pathname, storeConfigured: true, hasAccessIdentity, hasPortalSession }).kind)
            .not.toBe('needs-access');
        }
      }
    }
  });
});
