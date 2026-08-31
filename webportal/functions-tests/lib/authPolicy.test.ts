import { describe, it, expect } from 'vitest';
import {
  checkNewPassword, describeRejection, isUsableEmail, foldEmail, decideLogin,
  hasExpired, expiryFrom, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
} from './authPolicy';

describe('checkNewPassword', () => {
  it('accepts a password at and above the minimum', () => {
    expect(checkNewPassword('x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(checkNewPassword('a rather long passphrase')).toBeNull();
  });

  it('rejects one character below the minimum', () => {
    expect(checkNewPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('too-short');
  });

  it('rejects one character above the maximum', () => {
    expect(checkNewPassword('x'.repeat(MAX_PASSWORD_LENGTH))).toBeNull();
    expect(checkNewPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('too-long');
  });

  it.each([[undefined], [null], [12345678901234], [{}], [[]]])('rejects %s as not text', (value) => {
    expect(checkNewPassword(value)).toBe('not-text');
  });

  it('rejects whitespace even when it is long enough to pass the length rule', () => {
    expect(checkNewPassword(' '.repeat(MIN_PASSWORD_LENGTH + 4))).toBe('blank');
  });

  it('refuses the password they are already using', () => {
    expect(checkNewPassword('the same passphrase', 'the same passphrase')).toBe('same-as-old');
    expect(checkNewPassword('a different passphrase', 'the same passphrase')).toBeNull();
  });

  it('has a sentence for every rejection it can return', () => {
    const rejections = ['not-text', 'blank', 'too-short', 'too-long', 'same-as-old'] as const;
    for (const rejection of rejections) {
      expect(describeRejection(rejection)).toMatch(/\S/);
    }
  });
});

describe('email handling', () => {
  it.each(['sam@clinic.org', 'sam.jones+bt@clinic.co.uk', "o'brien@clinic.org"])(
    'accepts %s', (email) => expect(isUsableEmail(email)).toBe(true),
  );

  it.each(['', 'sam', 'sam@clinic', 'sam @clinic.org', 'a@b.c d', 42, null, undefined])(
    'rejects %s', (email) => expect(isUsableEmail(email)).toBe(false),
  );

  it('rejects an address past the RFC length ceiling', () => {
    expect(isUsableEmail(`${'a'.repeat(320)}@clinic.org`)).toBe(false);
  });

  it('folds case and surrounding space to one lookup key', () => {
    expect(foldEmail('  Sam@Clinic.ORG ')).toBe('sam@clinic.org');
    expect(foldEmail('sam@clinic.org')).toBe(foldEmail('SAM@CLINIC.ORG'));
  });
});

describe('decideLogin', () => {
  it('denies a wrong password before it considers anything else', () => {
    expect(decideLogin({ passwordMatched: false, disabled: true, mustChangePassword: true }))
      .toEqual({ kind: 'denied' });
  });

  it('stops a disabled account even when the password is right', () => {
    expect(decideLogin({ passwordMatched: true, disabled: true, mustChangePassword: false }))
      .toEqual({ kind: 'disabled' });
  });

  it('sends a temp password to the change screen rather than into a session', () => {
    expect(decideLogin({ passwordMatched: true, disabled: false, mustChangePassword: true }))
      .toEqual({ kind: 'must-change-password' });
  });

  it('signs in a live account with a real password', () => {
    expect(decideLogin({ passwordMatched: true, disabled: false, mustChangePassword: false }))
      .toEqual({ kind: 'signed-in' });
  });

  it('prefers disabled over must-change when both are true', () => {
    expect(decideLogin({ passwordMatched: true, disabled: true, mustChangePassword: true }))
      .toEqual({ kind: 'disabled' });
  });
});

describe('expiry', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  it('counts forward in whole hours', () => {
    expect(expiryFrom(now, 12)).toBe('2026-08-31T00:00:00.000Z');
  });

  it('treats the exact expiry moment as expired', () => {
    expect(hasExpired('2026-08-30T12:00:00.000Z', now)).toBe(true);
    expect(hasExpired('2026-08-30T12:00:00.001Z', now)).toBe(false);
    expect(hasExpired('2026-08-30T11:59:59.999Z', now)).toBe(true);
  });

  it('treats an unparseable expiry as expired rather than as forever', () => {
    expect(hasExpired('not a date', now)).toBe(true);
    expect(hasExpired('', now)).toBe(true);
  });
});
