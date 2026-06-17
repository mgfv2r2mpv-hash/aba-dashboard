#!/usr/bin/env node
// Ensures NSFaceIDUsageDescription is present in ios/App/App/Info.plist.
// Face ID requires this key — the plugin reports biometry unavailable without it.
// Touch ID does not require any key. Run this after `cap copy ios`.

const fs = require('fs');
const path = require('path');

const PLIST_PATH = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');
const KEY = 'NSFaceIDUsageDescription';
const VALUE = 'This app uses Face ID to unlock access to your protected schedule data.';

if (!fs.existsSync(PLIST_PATH)) {
  console.log('[patch-ios-plist] Info.plist not found at', PLIST_PATH);
  console.log('[patch-ios-plist] Run `npx cap add ios` then `npx cap sync ios` first.');
  process.exit(0);
}

let content = fs.readFileSync(PLIST_PATH, 'utf8');

if (content.includes(KEY)) {
  console.log('[patch-ios-plist] NSFaceIDUsageDescription already present — nothing to do.');
  process.exit(0);
}

// Insert before the closing </dict> tag.
const ENTRY = `\t<key>${KEY}</key>\n\t<string>${VALUE}</string>\n`;
content = content.replace('</dict>\n</plist>', `${ENTRY}</dict>\n</plist>`);
fs.writeFileSync(PLIST_PATH, content, 'utf8');
console.log('[patch-ios-plist] Added NSFaceIDUsageDescription to Info.plist.');
