// App-lock: a numeric PIN gate plus at-rest encryption of the schedule.
//
// Design (see CLAUDE.md compliance notes for the wider app):
//   - The PIN is never stored. Both the "verifier" and the schedule itself are
//     AES-GCM blobs whose key is PBKDF2-derived from the PIN (via clientCrypto).
//     A correct PIN is the one that decrypts them; a wrong PIN throws.
//   - The verifier is a known constant encrypted under the PIN. Its presence is
//     how we know a PIN has been set; decrypting it is how we validate entry,
//     independent of whether any schedule has been saved yet.
//   - The schedule blob is re-written on every change so a cold launch can
//     restore exactly what was on screen — encrypted, keyed by the same PIN.
//
// Face ID (see biometric.ts) is wired but dormant: when the user opts in, the
// PIN is stashed under app-constant obfuscation so a biometric success can
// recover it. That trades a little at-rest strength (the schedule key becomes
// recoverable from disk) for convenience — an explicit opt-in, off by default.

import { encryptString, decryptString, obfuscateKey, deobfuscateKey } from './clientCrypto';
import { readBlob, writeBlob, deleteBlob } from './secureStore';
import { ScheduleData } from './types';
import { wrapEnvelope, unwrapEnvelope } from './scheduleMigrations';

const VERIFIER_KEY = 'pin.verifier';
const SCHEDULE_KEY = 'schedule.enc';
const AICONFIG_KEY = 'aiconfig.enc';
const FACEID_KEY = 'faceid.enabled';
const PIN_STASH_KEY = 'pin.stash';

// The AI config we persist at rest. The API key is the sensitive part;
// model and schedulePassword ride along so they survive upgrades/reinstalls.
export interface StoredAIConfig {
  apiKey: string;
  model: string;
  schedulePassword?: string;
}

// Constant sealed under the PIN. Decrypting back to this exact string proves the
// entered PIN matches the one that set the lock.
const VERIFIER_PLAINTEXT = 'aba-dashboard::pin-ok::v1';

// ---- PIN lifecycle --------------------------------------------------------

export async function hasPin(): Promise<boolean> {
  return (await readBlob(VERIFIER_KEY)) !== null;
}

export async function setPin(pin: string): Promise<void> {
  await writeBlob(VERIFIER_KEY, await encryptString(VERIFIER_PLAINTEXT, pin));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const blob = await readBlob(VERIFIER_KEY);
  if (!blob) return false;
  try {
    return (await decryptString(blob, pin)) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

// Re-key everything to a new PIN. Caller must have verified the old PIN first
// (we pass the already-decrypted schedule through, so nothing is lost).
export async function changePin(newPin: string, currentSchedule: ScheduleData | null): Promise<void> {
  await setPin(newPin);
  if (currentSchedule) await saveSchedule(currentSchedule, newPin);
  else await deleteBlob(SCHEDULE_KEY);
  // If Face ID was on, refresh the stash so it tracks the new PIN.
  if (await isFaceIdEnabled()) await writeBlob(PIN_STASH_KEY, await obfuscateKey(newPin));
}

export async function clearLock(): Promise<void> {
  await deleteBlob(VERIFIER_KEY);
  await deleteBlob(SCHEDULE_KEY);
  await deleteBlob(AICONFIG_KEY);
  await deleteBlob(FACEID_KEY);
  await deleteBlob(PIN_STASH_KEY);
}

// Drop every at-rest blob EXCEPT the verifier. Used when creating a brand-new
// PIN: any pre-existing schedule/AI-config was sealed under a PIN we can no
// longer read, so it is unrecoverable garbage. Clearing it guarantees a fresh
// PIN behaves like a fresh install — no stale or inaccessible data lingers
// under the new key. (The verifier is written separately by setPin.)
export async function clearStaleAtRest(): Promise<void> {
  await deleteBlob(SCHEDULE_KEY);
  await deleteBlob(AICONFIG_KEY);
  await deleteBlob(FACEID_KEY);
  await deleteBlob(PIN_STASH_KEY);
}

// ---- At-rest schedule -----------------------------------------------------

export async function saveSchedule(data: ScheduleData, pin: string): Promise<void> {
  // Persist inside a versioned envelope so the schema can evolve independently
  // of the Excel workbook (see scheduleMigrations.ts).
  await writeBlob(SCHEDULE_KEY, await encryptString(wrapEnvelope(data), pin));
}

export async function loadSchedule(pin: string): Promise<ScheduleData | null> {
  const blob = await readBlob(SCHEDULE_KEY);
  if (!blob) return null;
  try {
    // Accepts both the versioned envelope and pre-envelope legacy JSON, and
    // migrates/backfills to the current schema on read.
    return unwrapEnvelope(await decryptString(blob, pin));
  } catch {
    // Wrong PIN or corrupt blob — caller already validated the PIN via the
    // verifier, so this would only happen on corruption. Fail soft to empty.
    return null;
  }
}

// ---- At-rest AI config (API key + model) ----------------------------------
//
// The Claude API key is encrypted under the same PIN as the schedule, so it
// survives a cold launch and is never readable from disk in plaintext. It is
// recovered on unlock (PIN entry or, when enabled, Face ID → PIN → decrypt) —
// the same gate that opens the app.

export async function saveAIConfig(config: StoredAIConfig, pin: string): Promise<void> {
  await writeBlob(AICONFIG_KEY, await encryptString(JSON.stringify(config), pin));
}

export async function loadAIConfig(pin: string): Promise<StoredAIConfig | null> {
  const blob = await readBlob(AICONFIG_KEY);
  if (!blob) return null;
  try {
    return JSON.parse(await decryptString(blob, pin)) as StoredAIConfig;
  } catch {
    return null;
  }
}

export async function clearAIConfig(): Promise<void> {
  await deleteBlob(AICONFIG_KEY);
}

// ---- Face ID opt-in -------------------------------------------------------

export async function isFaceIdEnabled(): Promise<boolean> {
  return (await readBlob(FACEID_KEY)) === '1';
}

// Enabling stashes the (known-good) PIN so a later biometric success can
// recover it. Caller passes the PIN it just verified.
export async function enableFaceId(verifiedPin: string): Promise<void> {
  await writeBlob(PIN_STASH_KEY, await obfuscateKey(verifiedPin));
  await writeBlob(FACEID_KEY, '1');
}

export async function disableFaceId(): Promise<void> {
  await deleteBlob(FACEID_KEY);
  await deleteBlob(PIN_STASH_KEY);
}

// Recover the PIN after a successful biometric prompt. Returns null if Face ID
// isn't set up. Only call this once biometricAuthenticate() has succeeded.
export async function recoverPinViaBiometric(): Promise<string | null> {
  const stash = await readBlob(PIN_STASH_KEY);
  if (!stash) return null;
  try { return await deobfuscateKey(stash); } catch { return null; }
}
