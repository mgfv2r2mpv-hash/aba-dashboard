// Decides what the native at-rest AI-config store should do when AI settings
// change. Kept pure and dependency-free so it can be unit-tested without the
// Capacitor/crypto layers that the actual persistence (appLock.ts) pulls in.
//
// The bug this guards against: persistence used to be gated on the API key
// alone, so setting a schedule password with no key cleared the whole config
// (wiping the password at rest). The password must survive on its own.
import type { StoredAIConfig } from './appLock';

// Structural subset of AISettings — avoids importing a component module here.
export interface AIConfigInput {
  apiKey: string;
  model: string;
  schedulePassword?: string;
}

export type AtRestAIAction =
  | { kind: 'save'; config: StoredAIConfig }
  | { kind: 'clear' };

// Save whenever there is anything worth persisting (key OR schedule password);
// only clear when both are absent.
export function resolveAtRestAIConfig(settings: AIConfigInput): AtRestAIAction {
  const hasKey = !!settings.apiKey;
  const hasPassword = !!settings.schedulePassword;
  if (!hasKey && !hasPassword) return { kind: 'clear' };
  return {
    kind: 'save',
    config: {
      apiKey: settings.apiKey || '',
      model: settings.model,
      schedulePassword: settings.schedulePassword,
    },
  };
}
