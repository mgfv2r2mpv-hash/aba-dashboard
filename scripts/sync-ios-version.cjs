#!/usr/bin/env node
// Keeps the Xcode project's versions in step with the repo:
//   - Always: MARKETING_VERSION (CFBundleShortVersionString) = package.json version.
//   - With --stamp: CURRENT_PROJECT_VERSION (CFBundleVersion) = UTC YYYYMMDDHHMM,
//     a monotonic build number for App Store Connect uploads. Run via
//     `npm run ios:stamp` before every archive — once a stamped build has been
//     uploaded, later uploads of the same version must keep increasing.
// `cap sync` never rewrites these pbxproj fields, so this runs in the cap:ios chain.

const fs = require('fs');
const path = require('path');

const PBXPROJ_PATH = path.join(__dirname, '..', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const pkg = require('../package.json');

if (!fs.existsSync(PBXPROJ_PATH)) {
  console.error('[sync-ios-version] project.pbxproj not found at', PBXPROJ_PATH);
  process.exit(1);
}

const original = fs.readFileSync(PBXPROJ_PATH, 'utf8');
let content = original;

const MARKETING = /MARKETING_VERSION = [^;]+;/g;
if (!MARKETING.test(content)) {
  console.error('[sync-ios-version] No MARKETING_VERSION settings found — pbxproj layout changed?');
  process.exit(1);
}
content = content.replace(MARKETING, `MARKETING_VERSION = ${pkg.version};`);

if (process.argv.includes('--stamp')) {
  const BUILD = /CURRENT_PROJECT_VERSION = [^;]+;/g;
  if (!BUILD.test(content)) {
    console.error('[sync-ios-version] No CURRENT_PROJECT_VERSION settings found — pbxproj layout changed?');
    process.exit(1);
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  content = content.replace(BUILD, `CURRENT_PROJECT_VERSION = ${stamp};`);
  console.log(`[sync-ios-version] Stamped build number ${stamp}.`);
}

if (content === original) {
  console.log(`[sync-ios-version] Already at ${pkg.version} — nothing to do.`);
} else {
  fs.writeFileSync(PBXPROJ_PATH, content, 'utf8');
  console.log(`[sync-ios-version] MARKETING_VERSION set to ${pkg.version}.`);
}
