// What the BCBA reads when a turn fails. The SDK's APIError.message is the status
// line with the whole JSON body appended, so an error written to be read arrived
// on screen wrapped in braces and escapes.
import { describe, it, expect } from 'vitest';
import { readableError } from './sassiSession';

describe('readableError', () => {
  it('pulls the written sentence out of an API error body', () => {
    const err: any = new Error('503 {"error":{"type":"not_configured","message":"The assistant is not configured on this server yet."}}');
    err.error = { error: { type: 'not_configured', message: 'The assistant is not configured on this server yet.' } };
    expect(readableError(err)).toBe('The assistant is not configured on this server yet.');
  });

  it('falls back to the error message when there is no body to read', () => {
    expect(readableError(new Error('Failed to fetch'))).toBe('Failed to fetch');
  });

  it('ignores a body whose message is empty rather than showing a blank error', () => {
    const err: any = new Error('500 Internal Server Error');
    err.error = { error: { message: '   ' } };
    expect(readableError(err)).toBe('500 Internal Server Error');
  });
});
