# Project notes for Claude

## Git workflow — read this first

The harness proxy on this repo **denies direct pushes to `main`** with HTTP 403
(the 403 carries Cloudflare / api.anthropic.com response headers, confirming it's
the proxy rather than the GitHub remote rejecting the push). Earlier in May 2026
direct pushes worked; they stopped after a proxy restart mid-session.

**Standard flow until the owner says otherwise:**

1. Develop on the session's designated feature branch
   (`claude/enable-ios-file-sharing-qKyys` historically; whatever the current
   session was assigned).
2. `git push origin <feature-branch>` — this is always allowed.
3. Open a PR from the feature branch into `main` via
   `mcp__github__create_pull_request`.
4. Merge it via `mcp__github__merge_pull_request` with `merge_method: 'rebase'`
   so `main` stays linear and ends at the same code state a direct push would
   have produced.
5. Locally, `git fetch origin main` so the local refs match.

Do **not** retry direct pushes to `main`; they will fail the same way and burn
turn budget. The owner has explicitly authorized auto-merge into `main` for the
remainder of this session and future sessions until further notice — no need to
ask before each merge.

## Repo essentials

- iOS build flow: `npm run cap:ios` runs `vite build` then `npx cap copy ios`.
  Don't track `dist-client/` (already in `.gitignore`).
- The Capacitor WebView at `capacitor://localhost` has no Express server inside
  it, so all `/api/*` calls are short-circuited through `src/nativeApi.ts` —
  an axios adapter that routes them to an in-memory ScheduleData store. Keep
  any new server endpoints mirrored there.
- Build stamp is injected via Vite `define` (`__BUILD_TIME__`) and shown in
  the empty-state footer; useful for confirming the device isn't running a
  stale `ios/App/App/public/` copy.

## Compliance rules (BCBA-confirmed; do not re-derive)

- Supervision appointments carry CLIENT only — no technician field. The tech
  being supervised is inferred from overlapping client-sessions.
- Per-client compliance: supervision counts when it (a) is tagged with the
  client AND (b) time-overlaps any direct session for that client by any tech.
  BCBA-solo-with-client (no overlap) consumes BCBA hours but contributes 0.
- Per-RBT compliance (currently in `src/compliance.ts` as
  `computeTechCompliance`): denominator = ALL of that RBT's direct hours across
  clients; numerator = supervision time overlapping any of that RBT's directs.
  RBTs must hit BOTH the BACB 5% floor and the company target. Non-RBT BTs
  follow company target only.
- Insurer cap (`supervisionMaxHoursPercent`, typically 20%) is a display-only
  warning — over-cap ratios render in orange but don't change green/yellow/red
  status, since min and max are orthogonal axes.
- Deferred: authorization-utilization tracking, fieldwork hours for trainees.

## Phases (per QA discussions)

- Phase A — appointment lifecycle (complete/cancel with source + reason): done
- Phase B — compliance dashboard with per-client + per-tech: done
- Phase C — "find a spot" suggestion engine: not started
- Phase D — fieldwork hours tracking: deferred
