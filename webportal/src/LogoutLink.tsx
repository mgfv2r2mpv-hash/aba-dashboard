import React from 'react';

// Ends the Cloudflare Access SSO session. A same-tab, full-page navigation (there is
// no router) so the browser reaches Cloudflare's edge endpoint, which clears the
// CF_Authorization cookie; the next request is then re-gated by Access. `fixed` pins
// it to the top-right corner for the pre-load screens (which have no header).
export default function LogoutLink({ fixed = false }: { fixed?: boolean }) {
  const link = (
    <a className="btn-ghost" href="/cdn-cgi/access/logout" aria-label="Log out of the portal">
      ⇥ Log out
    </a>
  );
  return fixed ? <div className="portal-logout-fixed">{link}</div> : link;
}
