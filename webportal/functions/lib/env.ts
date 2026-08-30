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
}

export interface PortalContext {
  request: Request;
  env: PortalEnv;
}
