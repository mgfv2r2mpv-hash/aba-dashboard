import { describe, it, expect } from 'vitest';
import { resolveAtRestAIConfig } from './aiConfigPolicy';

describe('resolveAtRestAIConfig', () => {
  // Regression: a schedule password set without an API key must still be saved
  // at rest. Previously the no-key branch cleared the whole config, wiping the
  // password so it never survived a cold launch.
  it('saves the schedule password when no API key is set', () => {
    const action = resolveAtRestAIConfig({
      apiKey: '',
      model: 'claude-sonnet-4-6',
      schedulePassword: 'hunter2',
    });

    expect(action.kind).toBe('save');
    if (action.kind === 'save') {
      expect(action.config.schedulePassword).toBe('hunter2');
      expect(action.config.apiKey).toBe('');
    }
  });

  it('saves the API key when no schedule password is set', () => {
    const action = resolveAtRestAIConfig({
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
    });

    expect(action.kind).toBe('save');
    if (action.kind === 'save') {
      expect(action.config.apiKey).toBe('sk-test');
      expect(action.config.schedulePassword).toBeUndefined();
    }
  });

  it('saves both when key and password are set', () => {
    const action = resolveAtRestAIConfig({
      apiKey: 'sk-test',
      model: 'claude-opus-4-8',
      schedulePassword: 'hunter2',
    });

    expect(action).toEqual({
      kind: 'save',
      config: { apiKey: 'sk-test', model: 'claude-opus-4-8', schedulePassword: 'hunter2' },
    });
  });

  it('clears at rest only when neither key nor password is set', () => {
    expect(resolveAtRestAIConfig({ apiKey: '', model: 'claude-sonnet-4-6' })).toEqual({ kind: 'clear' });
    expect(
      resolveAtRestAIConfig({ apiKey: '', model: 'claude-sonnet-4-6', schedulePassword: '' }),
    ).toEqual({ kind: 'clear' });
  });
});
