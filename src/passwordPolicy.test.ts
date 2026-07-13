import { describe, it, expect } from 'vitest';
import { validatePassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './passwordPolicy';
import { PASSWORD_DICT } from './passwordDict';

// A small deterministic dictionary so the dictionary tests don't depend on the
// bundled wordlist (src/passwordDict.ts). Real callers pass the loaded set.
const DICT: ReadonlySet<string> = new Set(['encrypt', 'password', 'dragon']);

// Helpers: read the pass/fail of a single rule, and the overall verdict.
const ruleOk = (pw: string, id: string, dict?: ReadonlySet<string>): boolean =>
  !!validatePassword(pw, dict).rules.find((r) => r.id === id)?.ok;
const isValid = (pw: string, dict?: ReadonlySet<string>): boolean =>
  validatePassword(pw, dict).valid;

describe('validatePassword — baseline', () => {
  // 10 chars, 2 caps, 4 lowers, 2 digits (non-adjacent), 2 specials, no runs.
  const BASE = 'Kp7#wm!q2Z';

  it('accepts a password meeting every rule', () => {
    expect(isValid(BASE)).toBe(true);
    expect(isValid(BASE, DICT)).toBe(true);
  });

  it('exposes one rule object per requirement', () => {
    const ids = validatePassword(BASE, DICT).rules.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(['length', 'upper', 'lower', 'digits', 'special', 'noSpaceEnds', 'letterSeq', 'digitSeq', 'notDictionary']),
    );
  });
});

describe('validatePassword — character-class rules', () => {
  it('rejects under the minimum length', () => {
    const short = 'Kp7#w2!qZ'; // 9 chars, otherwise compliant
    expect(short.length).toBe(PASSWORD_MIN_LENGTH - 1);
    expect(ruleOk(short, 'length')).toBe(false);
    expect(isValid(short)).toBe(false);
  });

  it('rejects over the maximum length', () => {
    const long = 'Kp7#wm!q2Z'.repeat(13); // 130 chars
    expect(long.length).toBeGreaterThan(PASSWORD_MAX_LENGTH);
    expect(ruleOk(long, 'length')).toBe(false);
  });

  it('requires an uppercase letter', () => {
    expect(ruleOk('kp7#wm!q2z', 'upper')).toBe(false);
    expect(ruleOk('Kp7#wm!q2z', 'upper')).toBe(true);
  });

  it('requires a lowercase letter', () => {
    expect(ruleOk('KP7#WM!Q2Z', 'lower')).toBe(false);
    expect(ruleOk('KP7#wM!Q2Z', 'lower')).toBe(true);
  });

  it('requires at least two digits', () => {
    expect(ruleOk('Kp7#wm!qzZ', 'digits')).toBe(false); // one digit
    expect(ruleOk('Kp7#wm!q2Z', 'digits')).toBe(true); // two digits
  });

  it('requires at least two special characters', () => {
    expect(ruleOk('Kp7#wmyq2Z', 'special')).toBe(false); // one special
    expect(ruleOk('Kp7#wm!q2Z', 'special')).toBe(true); // two specials
  });

  it('allows injection-flavored special characters (they are only PBKDF2 input)', () => {
    // backtick + apostrophe are the two specials; must be accepted, not stripped.
    expect(ruleOk("Kp7`wm'q2Z", 'special')).toBe(true);
    expect(isValid("Kp7`wm'q2Z")).toBe(true);
  });

  it('rejects leading or trailing whitespace', () => {
    expect(ruleOk(' Kp7#wm!q2Z', 'noSpaceEnds')).toBe(false);
    expect(ruleOk('Kp7#wm!q2Z ', 'noSpaceEnds')).toBe(false);
    expect(ruleOk('Kp7#wm!q2Z', 'noSpaceEnds')).toBe(true);
  });
});

describe('validatePassword — letter sequences (3+ consecutive, both directions)', () => {
  it('rejects ascending and descending 3-letter alphabet runs', () => {
    for (const run of ['abc', 'cba', 'xyz', 'qrs', 'ABC']) {
      const pw = `K${run}7#m!q2Z`;
      expect(ruleOk(pw, 'letterSeq')).toBe(false);
    }
  });

  it('accepts a scrambled 3-letter run (acb passes where abc fails)', () => {
    expect(ruleOk('Kacb7#m!q2Z', 'letterSeq')).toBe(true);
    expect(isValid('Kacb7#m!q2Z')).toBe(true);
  });

  it('does not flag a 2-letter alphabet pair', () => {
    // "ab" adjacent is fine — only 3+ runs are forbidden for letters.
    expect(ruleOk('Kab9#m!q2Z', 'letterSeq')).toBe(true);
  });
});

describe('validatePassword — digit sequences (2+ consecutive, both directions)', () => {
  it('rejects any two adjacent consecutive digits', () => {
    for (const pair of ['45', '54', '98', '89', '12']) {
      const pw = `Kp${pair}wm!q#Z`;
      expect(ruleOk(pw, 'digitSeq')).toBe(false);
    }
  });

  it('accepts adjacent equal or gapped digits', () => {
    expect(ruleOk('Kp99wm!q#Z', 'digitSeq')).toBe(true); // equal, not consecutive
    expect(ruleOk('Kp93wm!q#Z', 'digitSeq')).toBe(true); // gap of 6
  });

  it('accepts consecutive digits separated by another character', () => {
    expect(ruleOk('Kp4w5m!q#Z', 'digitSeq')).toBe(true); // 4 and 5 not adjacent
  });
});

describe('validatePassword — dictionary (letter-run substrings ≥4)', () => {
  it('omits the dictionary rule entirely when no dict is supplied', () => {
    expect(validatePassword('Z#password9!q2').rules.find((r) => r.id === 'notDictionary')).toBeUndefined();
    // …and the same password is valid without the dict but invalid with it.
    expect(isValid('Z#password9!q2')).toBe(true);
    expect(isValid('Z#password9!q2', DICT)).toBe(false);
    expect(ruleOk('Z#password9!q2', 'notDictionary', DICT)).toBe(false);
  });

  it('a digit inserted mid-word breaks the run and defeats the match', () => {
    // "passw0rd" splits into runs "passw"/"rd" — neither contains "password".
    expect(ruleOk('Z#passw0rd9!q2', 'notDictionary', DICT)).toBe(true);
    expect(isValid('Z#passw0rd9!q2', DICT)).toBe(true);
  });

  it('ignores letter runs shorter than the 4-char floor', () => {
    // "dod" (3) is never checked even if it were in the dict.
    expect(ruleOk("'Acb9dod9*", 'notDictionary', new Set(['dod']))).toBe(true);
  });
});

describe('validatePassword — the specified worked examples', () => {
  it('@encrYpt45- is invalid (dictionary "encrypt" + digit run "45")', () => {
    expect(isValid('@encrYpt45-', DICT)).toBe(false);
    expect(ruleOk('@encrYpt45-', 'notDictionary', DICT)).toBe(false);
    expect(ruleOk('@encrYpt45-', 'digitSeq', DICT)).toBe(false);
  });

  it('@encrYp4t5- is valid (word split by a digit, digits non-adjacent)', () => {
    expect(isValid('@encrYp4t5-', DICT)).toBe(true);
  });

  it("'abc9dod9 is invalid (short, one special, no capital, abc run)", () => {
    expect(isValid("'abc9dod9")).toBe(false);
    expect(ruleOk("'abc9dod9", 'letterSeq')).toBe(false);
    expect(ruleOk("'abc9dod9", 'special')).toBe(false); // only the leading '
    expect(ruleOk("'abc9dod9", 'upper')).toBe(false);
  });

  it("'acb9dod9* fails ONLY on the missing uppercase (scramble + 2nd special are fine)", () => {
    // Honest verdict: the requirement includes an uppercase letter, which this
    // string lacks. Its letter-scramble and two specials DO pass.
    expect(ruleOk("'acb9dod9*", 'letterSeq')).toBe(true);
    expect(ruleOk("'acb9dod9*", 'special')).toBe(true);
    expect(ruleOk("'acb9dod9*", 'upper')).toBe(false);
    expect(isValid("'acb9dod9*")).toBe(false);
  });

  it("'Acb9dod9* (adds the capital) is valid", () => {
    expect(isValid("'Acb9dod9*")).toBe(true);
  });
});

describe('bundled dictionary (src/passwordDict.ts)', () => {
  it('contains common weak base words and excludes short/digit tokens', () => {
    expect(PASSWORD_DICT.has('password')).toBe(true);
    expect(PASSWORD_DICT.has('dragon')).toBe(true);
    expect(PASSWORD_DICT.has('therapy')).toBe(true);
    for (const w of PASSWORD_DICT) {
      expect(w.length).toBeGreaterThanOrEqual(4);
      expect(w).toMatch(/^[a-z]+$/); // pure lowercase letters — matches how runs are compared
    }
  });

  it('flags an otherwise-strong password built on a real dictionary word', () => {
    // "Dragon" is a bundled word; the rest satisfies every other rule.
    expect(isValid('Dragon72!k#Z', PASSWORD_DICT)).toBe(false);
    expect(validatePassword('Dragon72!k#Z', PASSWORD_DICT).rules.find((r) => r.id === 'notDictionary')?.ok).toBe(false);
    // Splitting the word with a digit clears the dictionary rule.
    expect(isValid('Drag0n72!k#Z', PASSWORD_DICT)).toBe(true);
  });
});
