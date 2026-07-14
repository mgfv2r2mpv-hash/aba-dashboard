import { describe, it, expect } from 'vitest';
import { sanitizeBackupName, backupFilename, BACKUP_EXTENSION } from './backupFilename';

describe('sanitizeBackupName', () => {
  it('lowercases a plain name', () => {
    expect(sanitizeBackupName('Kaleb')).toBe('kaleb');
  });

  it('collapses spaces and punctuation runs to single dashes', () => {
    expect(sanitizeBackupName('Sunrise ABA, LLC')).toBe('sunrise-aba-llc');
  });

  it('trims leading and trailing separators', () => {
    expect(sanitizeBackupName('  --My Practice-- ')).toBe('my-practice');
  });

  it('falls back to sassi for undefined, empty, and all-symbol names', () => {
    expect(sanitizeBackupName(undefined)).toBe('sassi');
    expect(sanitizeBackupName('')).toBe('sassi');
    expect(sanitizeBackupName('★☆!!')).toBe('sassi');
  });
});

describe('backupFilename', () => {
  it('formats name, zero-padded local date, and HHMM time', () => {
    const at = new Date(2026, 6, 14, 9, 5); // July 14 2026, 09:05 local
    expect(backupFilename('Sunrise ABA', at)).toBe('sunrise-aba_2026-07-14_0905.sassi');
  });

  it('uses the fallback name when none is set', () => {
    const at = new Date(2026, 11, 3, 23, 59);
    expect(backupFilename(undefined, at)).toBe('sassi_2026-12-03_2359.sassi');
  });

  it('always ends with the app extension', () => {
    expect(backupFilename('x')).toMatch(new RegExp(`\\${BACKUP_EXTENSION}$`));
  });
});
