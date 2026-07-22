// Shared settings TYPES only.
//
// The standalone <Settings> modal that used to live here was a 1:1 duplicate of
// AdminPanel's app-lock / AI-key / schedule-password editors and was never
// rendered — it was retired in P3 (surface consolidation). AdminPanel's
// SettingsEditor is the single settings home now. These type/interface exports
// are still the shared contract, imported by app.tsx and AdminPanel.

export type ClaudeModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

export interface AISettings {
  apiKey: string;
  model: ClaudeModel;
  // Optional whole-file password. When set, downloaded schedules are encrypted
  // with it (opaque in a file browser) and re-import prompts for it. Held in
  // session only — never written into the file.
  schedulePassword?: string;
  // Google Maps API key powering travel-time routing. Same at-rest secrecy as the
  // Claude key (sealed under the PIN; obfuscated in the workbook embed). Only
  // public city centroids + the home address + times are ever sent to Google.
  mapsApiKey?: string;
}

// App-lock controls, passed only on native platforms.
export interface LockControls {
  faceIdAvailable: boolean;
  faceIdEnabled: boolean;
  // What to call the device's biometry ("Face ID" / "Touch ID").
  biometryLabel?: string;
  onChangePin: () => void;
  onToggleFaceId: (on: boolean) => void;
}
