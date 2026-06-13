// Client-side encryption for sensitive data (API keys) before sending to server.
// Uses Web Crypto API - the user's password never leaves the browser.
const ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt: salt,
        iterations: ITERATIONS,
        hash: 'SHA-256',
    }, baseKey, { name: 'AES-GCM', length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
}
export async function encryptString(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext));
    // Combine salt + iv + ciphertext, then base64
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
    return btoa(String.fromCharCode(...combined));
}
export async function decryptString(encrypted, password) {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
}
// ---------------------------------------------------------------------------
// Layer 1 — API-key "eyeball" obfuscation.
//
// The Claude API key rides inside the workbook so it follows the schedule, but
// it should not sit there in plaintext for a casual look. This is deliberately
// only obfuscation (a constant app key, not a user secret): the app can always
// un-obfuscate it with no prompt. Real protection comes from Layer 2 (the
// whole-file password). `encryptString`/`decryptString` above remain for the
// password-based path; these are the no-prompt app-key path.
// ---------------------------------------------------------------------------
// Constant, app-embedded passphrase. Not a secret in any cryptographic sense —
// it's in the bundle — it just keeps the key from being readable at a glance.
const APP_OBFUSCATION_PASSPHRASE = 'aba-dashboard::eyeball::v1';
export async function obfuscateKey(plaintext) {
    return encryptString(plaintext, APP_OBFUSCATION_PASSPHRASE);
}
export async function deobfuscateKey(blob) {
    return decryptString(blob, APP_OBFUSCATION_PASSPHRASE);
}
// ---------------------------------------------------------------------------
// Layer 2 — whole-file encryption with the user's schedule password.
//
// Encrypts the raw .xlsx bytes so the file is unintelligible in a file browser
// and unopenable in the app without the password. A short magic header lets the
// upload path detect an encrypted file before attempting to parse it as xlsx.
// ---------------------------------------------------------------------------
// "ABAENC1" — 7 ASCII bytes prepended to every encrypted blob.
const MAGIC = new Uint8Array([0x41, 0x42, 0x41, 0x45, 0x4e, 0x43, 0x31]);
function startsWithMagic(bytes) {
    if (bytes.length < MAGIC.length)
        return false;
    for (let i = 0; i < MAGIC.length; i++)
        if (bytes[i] !== MAGIC[i])
            return false;
    return true;
}
// True if these bytes look like an app-encrypted schedule (vs. a plain xlsx,
// which is a PKZIP archive starting with "PK").
export function isEncryptedSchedule(bytes) {
    return startsWithMagic(bytes);
}
export async function encryptBytes(plain, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
    const ct = new Uint8Array(ciphertext);
    const out = new Uint8Array(MAGIC.length + salt.length + iv.length + ct.length);
    out.set(MAGIC, 0);
    out.set(salt, MAGIC.length);
    out.set(iv, MAGIC.length + salt.length);
    out.set(ct, MAGIC.length + salt.length + iv.length);
    return out;
}
export async function decryptBytes(blob, password) {
    if (!startsWithMagic(blob))
        throw new Error('Not an encrypted schedule file');
    const base = MAGIC.length;
    const salt = blob.slice(base, base + SALT_LENGTH);
    const iv = blob.slice(base + SALT_LENGTH, base + SALT_LENGTH + IV_LENGTH);
    const ciphertext = blob.slice(base + SALT_LENGTH + IV_LENGTH);
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
    return new Uint8Array(decrypted);
}
//# sourceMappingURL=clientCrypto.js.map