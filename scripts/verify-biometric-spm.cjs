#!/usr/bin/env node
// Regression guard: verifies the biometric SPM setup is correct.
//
// RED if Plugin.swift lacks CAPBridgedPlugin conformance (bug: no Face ID dialog).
// GREEN after patch-spm-biometric.cjs adds the conformance.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'node_modules/@aparajita/capacitor-biometric-auth');
const PKG_PATH = path.join(PLUGIN_DIR, 'Package.swift');
const SWIFT_PATH = path.join(PLUGIN_DIR, 'ios/Plugin/Plugin.swift');

let passed = true;

function check(name, condition, failMsg) {
  if (!condition) {
    console.error(`✗ ${name}: ${failMsg}`);
    passed = false;
  } else {
    console.log(`✓ ${name}`);
  }
}

const pkgContent = fs.existsSync(PKG_PATH) ? fs.readFileSync(PKG_PATH, 'utf8') : '';
check(
  'Package.swift exists',
  pkgContent.length > 0,
  'File not found — run node scripts/patch-spm-biometric.cjs'
);
check(
  'Package.swift scopes to Plugin.swift only (sources array)',
  pkgContent.includes('sources: ["Plugin.swift"]'),
  'Mixed-language target will fail on Xcode 26 — Plugin.m must be excluded'
);

const swiftContent = fs.existsSync(SWIFT_PATH) ? fs.readFileSync(SWIFT_PATH, 'utf8') : '';
check('Plugin.swift exists', swiftContent.length > 0, 'File not found');
check(
  'Plugin.swift declares CAPBridgedPlugin conformance',
  swiftContent.includes('CAPBridgedPlugin'),
  'BiometricAuthNative is not discoverable by the Capacitor bridge — no Face ID dialog will appear'
);
check(
  'Plugin.swift exposes checkBiometry in pluginMethods',
  swiftContent.includes('"checkBiometry"'),
  'checkBiometry not in pluginMethods — JS call will silently fail'
);
check(
  'Plugin.swift exposes internalAuthenticate in pluginMethods',
  swiftContent.includes('"internalAuthenticate"'),
  'internalAuthenticate not in pluginMethods — Face ID prompt will never appear'
);

if (!passed) {
  console.error('\nVerification FAILED — run: node scripts/patch-spm-biometric.cjs');
  process.exit(1);
}
console.log('\nBiometric SPM setup OK');
