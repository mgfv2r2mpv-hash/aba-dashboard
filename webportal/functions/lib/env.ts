// The bindings the auth endpoints need from the Pages project.
//
// PORTAL_DB is a D1 binding and, like every binding, it is a PROJECT setting that a
// deploy does not create. Adding it in the dashboard (Settings -> Bindings) for both
// Production and Preview is a separate step from shipping this code, and bindings
// attach at deploy time: a binding added after a deployment does not reach it.
// Until it is there every endpoint here answers 503 and says so in a plain sentence.
import type { D1Like } from './userStore';

export interface PortalEnv {
  PORTAL_DB?: D1Like;
  /**
   * Resend's API key, for the temporary-password invitation. Like PORTAL_DB this is a
   * project setting rather than something a deploy creates, and it attaches at deploy
   * time. Without it the portal still makes accounts; it just cannot post the password
   * out, and says so instead of pretending it did.
   */
  RESEND_API_KEY?: string;
  /** Overrides the address invitations are sent from. Defaults in lib/mail.ts. */
  PORTAL_MAIL_FROM?: string;
}

/**
 * What _middleware.ts hands down. `accessEmail` comes out of a VERIFIED Access token,
 * never off the raw Cf-Access-Authenticated-User-Email header: Cloudflare only strips
 * a client-supplied copy of that header while Access is in front of the origin, and
 * relaxing Access is exactly what app login is for.
 */
export interface PortalData {
  accessEmail: string | null;
  /**
   * The account id behind the portal session cookie, or null. The middleware has to
   * resolve the session anyway to decide the gate, so passing the answer down costs
   * nothing and saves every endpoint a second lookup.
   */
  sessionUserId: string | null;
}

export interface PortalContext {
  request: Request;
  env: PortalEnv;
  data?: PortalData;
}
