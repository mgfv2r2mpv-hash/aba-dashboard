// Face ID / Touch ID wiring — present but dormant until the native plugin is
// added on the Mac side.
//
// We reach the plugin through Capacitor's registerPlugin() rather than a static
// import so the web bundle never needs the package installed. On web (and in
// this app today, before the pod is added) the proxy's methods reject with
// "not implemented", which we swallow — so the whole feature simply reports
// "unavailable" and the PIN flow carries on unchanged.
//
// To actually light this up on device:
//   1. npm i @aparajita/capacitor-biometric-auth   (registers as "BiometricAuth")
//   2. npx cap sync ios
//   3. Add NSFaceIDUsageDescription to ios/App/App/Info.plist
// The API shape below (checkBiometry / authenticate) matches that package.

import { Capacitor, registerPlugin } from '@capacitor/core';

interface BiometricAuthPlugin {
  checkBiometry(): Promise<{ isAvailable: boolean; biometryType?: number }>;
  authenticate(options?: { reason?: string; cancelTitle?: string }): Promise<void>;
}

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
