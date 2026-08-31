import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import UserAdminScreen from './UserAdminScreen';
import * as portalAuth from './portalAuth';

// The one layout rule on these screens that a browser proved and no test can measure.
//
// A real browser at 390px dragged the whole PAGE 269px sideways on the people screen.
// The cause was three separate facts standing next to each other:
//
//   1. the last column header carries a `.sr-only` span, and `.sr-only` is absolute,
//   2. that span sits inside `.auth-table-scroll`, which clips with `overflow-x: auto`,
//   3. `.auth-table-scroll` had no `position`, so the span resolved against the initial
//      containing block, escaped the clip, and landed at the TABLE's full width in page
//      coordinates.
//
// jsdom performs no layout, so none of that overflow is observable here. What IS
// observable is the three facts, and removing any one of them brings the defect back.
// So this file reads the three back, and says out loud what it cannot check: it proves
// the ingredients, never the pixels.

vi.mock('./portalAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof portalAuth>();
  return { ...actual, listUsers: vi.fn() };
});

// This suite runs under jsdom, where import.meta.url is an http URL rather than a
// file one, so the stylesheets are found from the runner's root instead.
const PORTAL_SRC = join(process.cwd(), 'webportal', 'src');
const authCss = readFileSync(join(PORTAL_SRC, 'auth', 'auth.css'), 'utf8');
const portalCss = readFileSync(join(PORTAL_SRC, 'portal.css'), 'utf8');

/** The declarations of the first rule whose selector list contains `selector`. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(^|[,{}])\\s*${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm');
  const found = rule.exec(css);
  if (!found) throw new Error(`No rule for ${selector}`);
  return found[3];
}

const ADMIN = {
  id: 'u0', email: 'boss@clinic.org', role: 'admin' as const,
  mustChangePassword: false, disabledAt: null,
  createdAt: '2026-08-01T00:00:00.000Z', passwordSetAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(portalAuth.listUsers).mockResolvedValue([ADMIN]);
});

describe('the people table cannot scroll the page sideways', () => {
  it('clips the table inside its own box rather than widening the page', () => {
    expect(declarationsFor(authCss, '.auth-table-scroll')).toMatch(/overflow-x:\s*auto/);
  });

  it('positions that box, so an absolute descendant cannot escape the clip', () => {
    // Load-bearing, and it looks like dead styling. Deleting this line is what the
    // browser measured as a 269px page-wide sideways scroll at 390px.
    expect(declarationsFor(authCss, '.auth-table-scroll')).toMatch(/position:\s*relative/);
  });

  it('has an absolute descendant to contain, which is why the position is needed', async () => {
    // The reason, not a restatement: a screen reader needs the actions column named,
    // the portal names it with .sr-only, and .sr-only is absolute.
    expect(declarationsFor(portalCss, '.sr-only')).toMatch(/position:\s*absolute/);

    render(<UserAdminScreen currentUser={ADMIN} onClose={vi.fn()} />);
    await screen.findByText('boss@clinic.org');

    const box = document.querySelector('.auth-table-scroll');
    expect(box).not.toBeNull();
    expect(box?.querySelector('.sr-only')).not.toBeNull();
  });
});
