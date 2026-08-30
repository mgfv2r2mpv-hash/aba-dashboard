-- Portal login store.
--
-- WHAT THIS TABLE IS AND IS NOT. It holds STAFF identities: the people who operate
-- SAssi. It never holds a client. The portal's whole PHI doctrine is that client
-- names stay in the browser and only UUIDs cross the wire, and nothing here changes
-- that. A row in portal_user is a colleague's work email, which is the same class of
-- data Cloudflare Access already stores about them.

CREATE TABLE IF NOT EXISTS portal_user (
  -- A uuid, never the email. Sessions and any later fieldwork records point at this,
  -- so somebody changing their email address does not orphan their history.
  id                    TEXT PRIMARY KEY,
  -- As typed, for showing back to them.
  email                 TEXT NOT NULL,
  -- Lowercased and trimmed. The uniqueness constraint lives on this one so that
  -- Sam@Clinic.org cannot open a second account against sam@clinic.org.
  email_folded          TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  -- 1 while the password on the row is a temp one an admin issued. Login succeeds
  -- and then refuses to go anywhere until it is replaced.
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  role                  TEXT NOT NULL DEFAULT 'bt' CHECK (role IN ('admin', 'staff', 'bt')),
  -- Set rather than deleting the row: a departed BT's fieldwork history has to
  -- outlive their access to the site.
  disabled_at           TEXT,
  created_at            TEXT NOT NULL,
  password_set_at       TEXT NOT NULL,
  last_login_at         TEXT
);

CREATE INDEX IF NOT EXISTS portal_user_role ON portal_user (role);

CREATE TABLE IF NOT EXISTS portal_session (
  -- The SHA-256 of the cookie value, never the value. Somebody who reads this table
  -- cannot replay a row into an account.
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES portal_user (id) ON DELETE CASCADE,
  -- 'session'         a signed-in person
  -- 'password-change' the short ticket a spent temp password buys, good for nothing
  --                   except setting a real password
  purpose     TEXT NOT NULL CHECK (purpose IN ('session', 'password-change')),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS portal_session_user ON portal_session (user_id);
CREATE INDEX IF NOT EXISTS portal_session_expiry ON portal_session (expires_at);
