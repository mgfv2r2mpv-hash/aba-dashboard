// Stub: @anthropic-ai/sdk — the web portal is read-only and never calls the
// Claude API, but ComplianceDashboard → FixItPanel → claudeScheduler pulls in
// the SDK import at build time.  This stub satisfies the import without adding
// the full SDK to the bundle.
export default class Anthropic {
  constructor(_opts?: unknown) {}
  messages = {
    create: (): never => {
      throw new Error('Claude API is not available in the web portal.');
    },
  };
}
export class APIError extends Error {}
export class AuthenticationError extends APIError {}
export class RateLimitError extends APIError {}
