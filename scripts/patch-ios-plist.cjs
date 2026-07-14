#!/usr/bin/env node
// Enforces required Info.plist keys after `cap sync ios`, idempotently:
//   1. NSFaceIDUsageDescription — Face ID reports biometry unavailable without it
//      (Touch ID needs no key).
//   2. ITSAppUsesNonExemptEncryption = false — the app's AES-GCM comes from
//      OS-provided WebCrypto standard algorithms (exempt), and without this key
//      every App Store Connect build sits in "Missing Compliance".
//   3. Removes UIRequiredDeviceCapabilities — the template shipped a malformed
//      array (empty string + 32-bit armv7) that fails upload validation.
// Runs last in `cap:ios` so template regeneration can't silently undo these.

const fs = require('fs');
const path = require('path');

const PLIST_PATH = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');

if (!fs.existsSync(PLIST_PATH)) {
  console.log('[patch-ios-plist] Info.plist not found at', PLIST_PATH);
  console.log('[patch-ios-plist] Run `npx cap add ios` then `npx cap sync ios` first.');
  process.exit(0);
}

const original = fs.readFileSync(PLIST_PATH, 'utf8');
let content = original;

// Append a key/value entry before the closing </dict> when the key is absent.
// `valueXml` is a raw plist element (<string>…</string>, <false/>, …) so
// booleans work as well as strings.
const ensureKey = (key, valueXml) => {
  if (content.includes(`<key>${key}</key>`)) return;
  const entry = `\t<key>${key}</key>\n\t${valueXml}\n`;
  content = content.replace('</dict>\n</plist>', `${entry}</dict>\n</plist>`);
  console.log(`[patch-ios-plist] Added ${key}.`);
};

ensureKey('NSFaceIDUsageDescription', '<string>Use Face ID to unlock your ABA schedule.</string>');
ensureKey('ITSAppUsesNonExemptEncryption', '<false/>');

// The append helper can't express removal — strip the key + its whole array.
const CAPS_BLOCK = /\t<key>UIRequiredDeviceCapabilities<\/key>\n\t<array>[\s\S]*?<\/array>\n/;
if (CAPS_BLOCK.test(content)) {
  content = content.replace(CAPS_BLOCK, '');
  console.log('[patch-ios-plist] Removed UIRequiredDeviceCapabilities.');
}

if (content === original) {
  console.log('[patch-ios-plist] All keys already correct — nothing to do.');
} else {
  fs.writeFileSync(PLIST_PATH, content, 'utf8');
  console.log('[patch-ios-plist] Info.plist updated.');
}
