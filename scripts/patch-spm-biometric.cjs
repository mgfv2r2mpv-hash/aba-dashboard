#!/usr/bin/env node
// Ensures @aparajita/capacitor-biometric-auth works with SPM.
//
// The plugin ships no Package.swift, so cap sync omits it from CapApp-SPM.
// This script:
//   1. Writes a Package.swift into the plugin's node_modules dir (so cap sync detects it).
//   2. If CapApp-SPM/Package.swift already exists and is missing biometric, patches it directly.
//
// Run BEFORE cap sync so step 1 takes effect; also safe to run after as a fallback.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'node_modules/@aparajita/capacitor-biometric-auth');
const PLUGIN_PKG_PATH = path.join(PLUGIN_DIR, 'Package.swift');
const SPM_PATH = path.join(ROOT, 'ios/App/CapApp-SPM/Package.swift');

const PLUGIN_PACKAGE_NAME = 'AparajitaCapacitorBiometricAuth';
const PLUGIN_PATH = '../../../node_modules/@aparajita/capacitor-biometric-auth';
const PLUGIN_PRODUCT = 'AparajitaCapacitorBiometricAuth';

const PLUGIN_PACKAGE_SWIFT = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "${PLUGIN_PACKAGE_NAME}",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "${PLUGIN_PACKAGE_NAME}",
            targets: ["BiometricAuth"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "BiometricAuth",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/BiometricAuthNative")
    ]
)
`;

// Step 1: always write the plugin Package.swift (node_modules gets wiped by npm install).
if (!fs.existsSync(PLUGIN_DIR)) {
  console.log('[patch-spm-biometric] Plugin not found in node_modules — run `npm install` first.');
  process.exit(1);
}
fs.writeFileSync(PLUGIN_PKG_PATH, PLUGIN_PACKAGE_SWIFT, 'utf8');
console.log('[patch-spm-biometric] Wrote Package.swift into @aparajita/capacitor-biometric-auth.');

// Step 1b: add CAPBridgedPlugin conformance to Plugin.swift so Capacitor can discover the plugin
// without Plugin.m (which is excluded to avoid the Xcode 26 mixed-language SPM error).
const PLUGIN_SWIFT_PATH = path.join(PLUGIN_DIR, 'ios/Plugin/Plugin.swift');
if (fs.existsSync(PLUGIN_SWIFT_PATH)) {
  let swiftContent = fs.readFileSync(PLUGIN_SWIFT_PATH, 'utf8');
  if (!swiftContent.includes('CAPBridgedPlugin')) {
    swiftContent = swiftContent.replace(
      'public class BiometricAuthNative: CAPPlugin {',
      `public class BiometricAuthNative: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "BiometricAuthNative"
  public let jsName = "BiometricAuthNative"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "checkBiometry", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "internalAuthenticate", returnType: CAPPluginReturnPromise),
  ]`
    );
    fs.writeFileSync(PLUGIN_SWIFT_PATH, swiftContent, 'utf8');
    console.log('[patch-spm-biometric] Added CAPBridgedPlugin conformance to Plugin.swift.');
  } else {
    console.log('[patch-spm-biometric] Plugin.swift already has CAPBridgedPlugin conformance.');
  }
}

// Step 2: patch CapApp-SPM/Package.swift if it exists and is missing the plugin.
if (!fs.existsSync(SPM_PATH)) {
  console.log('[patch-spm-biometric] CapApp-SPM/Package.swift not found — cap sync will pick it up via the plugin Package.swift.');
  process.exit(0);
}

let content = fs.readFileSync(SPM_PATH, 'utf8');

if (content.includes(PLUGIN_PACKAGE_NAME)) {
  console.log('[patch-spm-biometric] Biometric auth already in CapApp-SPM — nothing more to do.');
  process.exit(0);
}

// CapacitorShare is the last entry (no trailing comma); add comma then biometric.
const DEP_ANCHOR = /([ \t]+\.package\(name: "CapacitorShare"[^\n]+)(\n)/;
if (!DEP_ANCHOR.test(content)) {
  console.error('[patch-spm-biometric] Could not find CapacitorShare dependency anchor — Package.swift format may have changed.');
  process.exit(1);
}
content = content.replace(
  DEP_ANCHOR,
  `$1,\n        .package(name: "${PLUGIN_PACKAGE_NAME}", path: "${PLUGIN_PATH}")$2`
);

const PROD_ANCHOR = /([ \t]+\.product\(name: "CapacitorShare"[^\n]+)(\n)/;
if (!PROD_ANCHOR.test(content)) {
  console.error('[patch-spm-biometric] Could not find CapacitorShare product anchor — Package.swift format may have changed.');
  process.exit(1);
}
content = content.replace(
  PROD_ANCHOR,
  `$1,\n                .product(name: "${PLUGIN_PRODUCT}", package: "${PLUGIN_PACKAGE_NAME}")$2`
);

fs.writeFileSync(SPM_PATH, content, 'utf8');
console.log('[patch-spm-biometric] Injected AparajitaCapacitorBiometricAuth into CapApp-SPM/Package.swift.');
