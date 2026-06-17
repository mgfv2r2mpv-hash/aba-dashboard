// Face ID / Touch ID wiring.
//
// We bind directly to the plugin's *native* bridge via registerPlugin(), rather
// than importing @aparajita/capacitor-biometric-auth's JS wrapper. The wrapper
// pulls in @capacitor/app (an app-resume listener) and lazy-loaded chunks at
// startup, which crashed the iOS WebView on launch. The native plugin registers
// as "BiometricAuthNative" with two methods — `checkBiometry` and
// `internalAuthenticate` — and that's all we need. The npm package stays a
// dependency only so `cap sync ios` includes that native pod in the build.
//
// Every call is guarded by Capacitor.isNativePlatform(), so the web build is a
// no-op (web has no lock). On a real device, add NSFaceIDUsageDescription to
// ios/App/App/Info.plist — iOS crashes the first Face ID prompt without it
// (Touch ID needs no key).

import { Capacitor, registerPlugin } from '@capacitor/core';

// iOS biometryType values: 1 = Touch ID, 2 = Face ID.
const TOUCH_ID = 1;
const FACE_ID = 2;

interface BiometricAuthNativePlugin {
  checkBiometry(): Promise<{
    isAvailable: boolean;
    biometryType: number;
    reason?: string;
    errorCode?: string;
  }>;
  internalAuthenticate(options: { reason?: string; cancelTitle?: string }): Promise<void>;
}

// Bind to the native plugin name exposed by the pod (see @objc(BiometricAuthNative)
// in the package's ios/Plugin/Plugin.swift).
const Native = registerPlugin<BiometricAuthNativePlugin>('BiometricAuthNative');

// User-facing label for whatever biometry the device exposes, for UI copy.
export type BiometryLabel = 'Face ID' | 'Touch ID' | 'biometric unlock';

export async function isBiometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const res = await Native.checkBiometry();
    return !!res?.isAvailable;
  } catch {
    return false;
  }
}

// Single native call returning both availability and hardware label — use this
// instead of calling isBiometricAvailable() then getBiometryLabel() separately.
export async function checkBiometryFull(): Promise<{ available: boolean; label: BiometryLabel; reason?: string }> {
  if (!Capacitor.isNativePlatform()) return { available: false, label: 'biometric unlock' };
  try {
    const res = await Native.checkBiometry();
    const available = !!res?.isAvailable;
    const label: BiometryLabel = res?.biometryType === TOUCH_ID ? 'Touch ID'
      : res?.biometryType === FACE_ID ? 'Face ID'
      : 'biometric unlock';
    if (!available && res?.reason) {
      console.warn('[biometric] unavailable —', res.reason, res.errorCode ?? '');
    }
    return { available, label, reason: res?.reason };
  } catch (e) {
    console.warn('[biometric] checkBiometry threw:', e);
    return { available: false, label: 'biometric unlock' };
  }
}

// Names the actual hardware so the lock screen and Settings say "Touch ID" /
// "Face ID" instead of always "Face ID". Falls back to a generic phrase.
export async function getBiometryLabel(): Promise<BiometryLabel> {
  return (await checkBiometryFull()).label;
}

// Resolves true only on a successful biometric match. Any failure or cancel
// resolves false so the caller falls back to the PIN.
export async function biometricAuthenticate(reason: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await Native.internalAuthenticate({ reason, cancelTitle: 'Use PIN' });
    return true;
  } catch {
    return false;
  }
}
