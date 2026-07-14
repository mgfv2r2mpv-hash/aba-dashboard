// Friendly names for exported encrypted backups: <name>_<date>_<time>.sassi
// (e.g. sunrise-aba_2026-07-14_0930.sassi). The extension is cosmetic — imports
// are routed by content sniffing (ABAENC1 magic / JSON envelope), never by
// extension — so legacy .enc.json backups keep restoring unchanged.

export const BACKUP_EXTENSION = '.sassi';

// Lowercase, collapse every run of non-alphanumerics to a single dash, trim
// stray dashes. An empty/absent/all-symbol name falls back to the app label so
// the filename is never blank.
export function sanitizeBackupName(name?: string): string {
  const cleaned = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'sassi';
}

// Local time, injectable for tests.
export function backupFilename(name?: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${sanitizeBackupName(name)}_${date}_${time}${BACKUP_EXTENSION}`;
}
