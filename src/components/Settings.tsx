export type ClaudeModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

export interface AISettings {
  apiKey: string;
  model: ClaudeModel;
  // Optional whole-file password. When set, downloaded schedules are encrypted
  // with it (opaque in a file browser) and re-import prompts for it. Held in
  // session only — never written into the file.
  schedulePassword?: string;
}
