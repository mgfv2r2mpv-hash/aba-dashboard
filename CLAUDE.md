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

## Excel workbook format (v2, normalized — `src/excelHandler.ts`)

- `SCHEMA_VERSION = 2`. A `_Meta` sheet (`schemaVersion`, `id`, `lastModified`,
  `exportedAt`, `appName`) marks the format. The parser understands **v2 only**.
- **PTO (Upgrades 1–2):** BCBA leave lives in a `TimeOff` sheet (one row per
  leave day: `date,hours,bucket,note`). `Settings.ptoBillableDeductionRatio`
  (default 1.0) shaves the BCBA weekly/monthly billable requirement by
  `hours*ratio` (floored at 0) — read by the hours ribbon/grid AND the draft
  grader (`draftSolver`). Bucket/accrual config is `Settings.pto{Mode,Buckets,
  UnpaidEnabled}` cols + `PtoAccruals` + `PtoOpeningBalances` sheets; logic lives
  in `src/pto.ts` (`computePtoBalances`, `accruedForRule`). Mode `unlimited`
  (default) tracks used-only; `accrual` reports opening+accrued−used. Only the
  date-based accrual kinds (`semimonthly`,`everyNWeeks`) are computed — the
  `perConverted*` kinds round-trip but are deferred (accrue 0). Round-trip +
  logic covered by `scripts/verify-excel.ts` and `scripts/verify-pto.ts`.
- **Normalized, relational sheets:** `Clients`/`Technicians` hold scalars only;
  availability lives in one `Availability` sheet (`ownerType client|technician|
  clinician, ownerId, ownerName, day, start, end`, one row per window — this also
  replaces the old `settings.clinicianAvailability` JSON); tech-client links live
  in `Assignments`; cancellations live in `Cancellations` (child of canceled
  appointments). `Settings` is fully de-JSON'd (utilization, cancellation-notice,
  and report-lead fields are plain columns). `Authorizations`/`ManualUsage`/
  `Blackouts` unchanged. Company-customized cancellation **reason codes** live in
  a `CancellationCodes` sheet (`value`, `label`, `retired`), one row per code —
  empty/absent falls back to the built-in `CANCELLATION_REASONS`. Edited in
  Admin → Settings; reason `value`s are stable ids (retire, don't delete, so
  historical `Cancellations.reason` keep resolving via `cancellationReasonLabel`).
- Generated with `aoa_to_sheet` + explicit header arrays (stable column order) and
  **`XLSX.write(..., { compression: true })`** — the old generator stored the zip
  uncompressed (a real ~4–5x size bug: 463 KB → ~120 KB for the same data).
- Child sheets reference owners by id, falling back to name (mirrors the app's
  `find(x => x.id===v || x.name===v)`); denormalized name columns are for human
  readability only.
- **Legacy v1 files** (per-day `*Start/*End/*Windows`, `client1..hours10`,
  inline cancellation columns, JSON-packed Settings) are upgraded once via
  `scripts/migrate-legacy-xlsx.ts <in> <out> [data.json]`, which carries a
  self-contained v1 reader and folds the dead `reportLeadWeeks*` settings into
  the modern `reportDraftLead`/`reportFinalLead`.
- The bundled sample (`public-assets/sample_schedule.xlsx`) is regenerated from
  the `src/sampleSchedule.json` fixture via `npx tsx src/createSampleData.ts`.
  Round-trip coverage: `npx tsx scripts/verify-excel.ts`.
- Connectors (`nativeApi.ts`, `server.ts`, `app.tsx`) are pass-throughs over
  `parseWorkbook`/`generateExcelFile` — unchanged by the format rework.

## App lock & at-rest persistence (native only)

- On native, the app locks on **cold launch only** (no background/foreground
  re-lock — deliberately the simplest behavior). Web has no lock.
- A numeric PIN is the gate. The PIN is **never stored**: both the `pin.verifier`
  blob (a known constant) and the `schedule.enc` blob (the whole `ScheduleData`)
  are AES-GCM, key PBKDF2-derived from the PIN via `clientCrypto`. A correct PIN
  is the one that decrypts them. See `src/appLock.ts` + `src/secureStore.ts`
  (blobs live in `Directory.Data`, namespaced `lock_*`).
- First launch with no verifier → LockScreen "create" mode (a PIN is mandatory
  on native, so the at-rest key always exists before any save). The schedule is
  re-encrypted on every change (debounced 400ms in `app.tsx`) and restored on
  unlock — this is the ONLY cross-launch persistence (there's no GET on mount).
- **Face ID is wired but dormant.** `src/biometric.ts` reaches the plugin via
  `registerPlugin('BiometricAuth')` (no static import, so the web build needs no
  package). It reports unavailable until the owner, on the Mac:
  `npm i @aparajita/capacitor-biometric-auth` → `npx cap sync ios` → add
  `NSFaceIDUsageDescription` to `ios/App/App/Info.plist`. Opting in stashes the
  PIN under app-constant obfuscation (`pin.stash`) so a biometric success can
  recover it — a deliberate convenience/strength tradeoff, off by default.
- The schedule-decrypt prompt is a real `<form>` (`PasswordPrompt.tsx`,
  `autocomplete="current-password"`) not `window.prompt`, so iOS offers AutoFill.

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
