// Face ID / Touch ID wiring.
//
// The plugin (@aparajita/capacitor-biometric-auth, registers as "BiometricAuth")
// is now a project dependency. We still reach it through registerPlugin() rather
// than a static import so the web bundle never pulls the package in — on web the
// proxy's methods reject with "not implemented", which we swallow, so the feature
// reports "unavailable" and the PIN flow carries on unchanged (web has no lock).
//
// To finish lighting it up on a real device, on the Mac:
//   1. npm install                 (pulls the dependency added here)
//   2. npx cap sync ios            (installs the pod into the iOS project)
//   3. Add NSFaceIDUsageDescription to ios/App/App/Info.plist (required string;
//      iOS crashes the first Face ID prompt without it. Touch ID needs no key.)
// The API shape below (checkBiometry / authenticate) matches that package.

import { Capacitor, registerPlugin } from '@capacitor/core';

interface BiometricAuthPlugin {
  checkBiometry(): Promise<{ isAvailable: boolean; biometryType?: number }>;
  authenticate(options?: { reason?: string; cancelTitle?: string }): Promise<void>;
}

// iOS biometryType values (from @aparajita/capacitor-biometric-auth):
// 1 = Touch ID, 2 = Face ID. We map to a user-facing label so the lock screen
// and Settings name the actual hardware instead of always saying "Face ID".
export type BiometryLabel = 'Face ID' | 'Touch ID' | 'biometric unlock';

let cached: BiometricAuthPlugin | null = null;
function plugin(): BiometricAuthPlugin | null {
  if (!cached) {
    try { cached = registerPlugin<BiometricAuthPlugin>('BiometricAuth'); } catch { cached = null; }
  }
  return cached;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const p = plugin();
    if (!p) return false;
    const res = await p.checkBiometry();
    return !!res?.isAvailable;
  } catch {
    return false;
  }
}

// Friendly name for whatever biometry the device exposes, for UI copy. Falls
// back to a generic phrase when the type is unknown or the plugin is absent.
export async function getBiometryLabel(): Promise<BiometryLabel> {
  if (!Capacitor.isNativePlatform()) return 'biometric unlock';
  try {
    const p = plugin();
    if (!p) return 'biometric unlock';
    const res = await p.checkBiometry();
    if (res?.biometryType === 1) return 'Touch ID';
    if (res?.biometryType === 2) return 'Face ID';
    return 'biometric unlock';
  } catch {
    return 'biometric unlock';
  }
}

// Resolves true only on a successful biometric match. Any failure, cancel, or
// missing plugin resolves false so the caller falls back to the PIN.
export async function biometricAuthenticate(reason: string): Promise<boolean> {
  try {
    const p = plugin();
    if (!p) return false;
    await p.authenticate({ reason });
    return true;
  } catch {
    return false;
  }
}
