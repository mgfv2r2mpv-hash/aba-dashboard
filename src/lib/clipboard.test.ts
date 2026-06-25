import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from './clipboard';

function stubExecCommand(returns: boolean) {
  Object.defineProperty(document, 'execCommand', {
    value: vi.fn().mockReturnValue(returns),
    writable: true,
    configurable: true,
  });
}

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    stubExecCommand(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when navigator.clipboard succeeds', async () => {
    const result = await copyToClipboard('hello world');

    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when navigator.clipboard rejects (iOS WKWebView)', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
    });
    stubExecCommand(true);

    const result = await copyToClipboard('iOS fallback test');

    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when both navigator.clipboard and execCommand fail', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
    });
    stubExecCommand(false);

    const result = await copyToClipboard('total failure');

    expect(result).toBe(false);
  });
});
