// Face ID / Touch ID wiring.
//
// We use the plugin's own exported `BiometricAuth` proxy rather than a
// hand-rolled registerPlugin(): the native bridge registers under the name
// "BiometricAuthNative" (with an `internalAuthenticate` method) and the package
// wraps it with JS-side logic, so calling registerPlugin('BiometricAuth')
// ourselves binds to nothing native and always reports unavailable. The package
// ships a web implementation that reports unavailable, and every call here is
// guarded by Capacitor.isNativePlatform() first, so the web build is a no-op
// (web has no lock).
//
// Device requirement: add NSFaceIDUsageDescription to ios/App/App/Info.plist —
// iOS crashes the first Face ID prompt without it (Touch ID needs no key).

import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';

// iOS biometryType → user-facing label, so the lock screen and Settings name
// the actual hardware instead of always saying "Face ID".
export type BiometryLabel = 'Face ID' | 'Touch ID' | 'biometric unlock';

export async function isBiometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const res = await BiometricAuth.checkBiometry();
    return !!res.isAvailable;
  } catch {
    return false;
  }
}

// Friendly name for whatever biometry the device exposes, for UI copy. Falls
// back to a generic phrase when the type is unknown or unavailable.
export async function getBiometryLabel(): Promise<BiometryLabel> {
  if (!Capacitor.isNativePlatform()) return 'biometric unlock';
  try {
    const res = await BiometricAuth.checkBiometry();
    if (res.biometryType === BiometryType.touchId) return 'Touch ID';
    if (res.biometryType === BiometryType.faceId) return 'Face ID';
    return 'biometric unlock';
  } catch {
    return 'biometric unlock';
  }
}

// Resolves true only on a successful biometric match. Any failure or cancel
// resolves false so the caller falls back to the PIN.
export async function biometricAuthenticate(reason: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await BiometricAuth.authenticate({ reason, cancelTitle: 'Use PIN' });
    return true;
  } catch {
    return false;
  }
}
