# Project notes for Claude

## Coding methodology

Think like the laziest senior dev in the room. **The best code is the code you never wrote.**

- **Reuse before reinvent:** Use existing libraries, frameworks, and patterns. Copy-paste with confidence.
- **Simplest solution wins:** Pick the minimal approach that solves the problem. Avoid over-engineering and premature optimization.
- **Ship fast:** Get to done. Iterate later. Refactor only when something breaks.
- **Minimal diffs:** Every line should earn its place. No "while we're here" cleanups.
- **Trust tech users:** Assume app users are semi-confident with tech. Don't explain clinical rationale; focus on UI clarity for scheduling/compliance decisions.

**Non-negotiable guards (never sacrifice for efficiency):**
- Data security: encryption, at-rest keys, access gates never bypass.
- AI tool safety: anonymization, validation, and prompt hardening stay strict.
- Compliance logic: BCBA-confirmed rules in `src/compliance.ts` and constraint validators are law.

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

- **iOS build:** `npm run cap:ios` → vite build → `npx cap copy ios`. Don't track `dist-client/`.
- **Native API routing:** Capacitor WebView has no server. All `/api/*` calls route through `src/nativeApi.ts` (axios adapter → in-memory ScheduleData). Mirror new endpoints there.
- **Build stamp:** Vite-injected `__BUILD_TIME__` in footer shows current version (useful for detecting stale iOS builds).

## Excel workbook format (v2, normalized — `src/excelHandler.ts`)

- **Schema:** `SCHEMA_VERSION = 2`, marked by `_Meta` sheet. Parser understands v2 only.
- **PTO:** BCBA leave in `TimeOff` sheet (date,hours,bucket,note). `Settings.ptoBillableDeductionRatio` (default 1.0) shaves weekly/monthly billable requirement. Accrual config: `Settings.pto{Mode,Buckets,UnpaidEnabled}` + `PtoAccruals`/`PtoOpeningBalances` sheets. Logic in `src/pto.ts` — modes: `unlimited` (tracks used), `accrual` (opening+accrued−used). Four kinds: date-based (`semimonthly`,`everyNWeeks`) and hours-based (`perConvertedHours`,`perConvertedBonus`). **Converted = completed billable BCBA hours** — balances move as sessions complete/reopen. `perConvertedBonus` pays when N consecutive intervals hit criterion. Verified in `scripts/verify-excel.ts` / `scripts/verify-pto.ts`.
- **Normalized sheets:** `Clients`/`Technicians` (scalars); `Availability` (one row per window: ownerType, ownerId, ownerName, day, start, end); `Assignments` (tech-client links); `Cancellations`; `Settings` (de-JSON'd). `Authorizations`/`ManualUsage`/`Blackouts` unchanged. Company **reason codes** in `CancellationCodes` (value,label,retired) — fallback to built-in. Reason `value`s are stable IDs (retire, never delete).
- **Compression:** `XLSX.write(..., { compression: true })` — old uncompressed was 4–5x larger (463 KB → ~120 KB).
- **References:** Child sheets use id or name fallback (mirrors `find(x => x.id===v || x.name===v)`).
- **Legacy:** v1 files upgraded once via `scripts/migrate-legacy-xlsx.ts`. Self-contained v1 reader folds `reportLeadWeeks*` into modern `reportDraftLead`/`reportFinalLead`.
- **Sample:** Generated from `src/sampleSchedule.json` via `npx tsx src/createSampleData.ts`. Round-trip via `npx tsx scripts/verify-excel.ts`.

## App lock & at-rest persistence (native only)

- **Lock gate:** Numeric PIN, **never stored**. Both `pin.verifier` (constant) and `schedule.enc` (ScheduleData) are AES-GCM, key PBKDF2-derived from PIN via `clientCrypto`. Correct PIN = decryption success. See `src/appLock.ts` + `src/secureStore.ts` (blobs in `Directory.Data`, namespaced `lock_*`). Cold launch only; web has no lock.
- **Lifecycle:** First launch → LockScreen "create" mode (PIN mandatory on native). Schedule re-encrypted every change (debounced 400ms) on unlock → only cross-launch persistence (no GET on mount).
- **Biometric:** `@aparajita/capacitor-biometric-auth` v9 (Capacitor 8 compatible). `src/biometric.ts` via `registerPlugin('BiometricAuth')` (no static import → web build safe). `getBiometryLabel()` maps iOS type (1=Touch, 2=Face) to UI. Opt-in stashes PIN under obfuscation (`pin.stash`) for biometric recovery — convenience/strength tradeoff, off by default. **Setup:** `npm install` → `npx cap sync ios` → add `NSFaceIDUsageDescription` to `ios/App/App/Info.plist` (Face ID requires it; Touch ID doesn't).
- **Claude API key:** Two paths: (1) **workbook embed** (`_Config` sheet, app-obfuscated via `obfuscateKey`) for download→upload round-trip (no prompt); (2) **native at-rest** (`aiconfig.enc` blob via `saveAIConfig`/`loadAIConfig`, re-keyed on PIN change, cleared on lock clear). **Display:** Never shown after set ("🔒 API key is set" + Replace/Clear). Replace gated by `onRequestUnlock` (Face ID or PIN). Blank field on save = keep existing. Stores `schedulePassword` alongside for persistence across reinstalls.
- **Schedule password:** Optional whole-file encryption (workbook download). Never re-displayed; stored encrypted at rest. Changing requires current password (gate).
- **AutoFill:** Schedule-decrypt prompt is real `<form>` (`PasswordPrompt.tsx`, `autocomplete="current-password"`) for iOS AutoFill support.

## Compliance rules (BCBA-confirmed; do not re-derive)

- **Supervision credit = BT direct time-overlap** (`countsAsSupervision`). Only supervision, parent-training, case-planning count. **Supervision** (client present) → BT **inferred**, credit any overlap with that client's directs. **PT/CoC** (caregiver-only) → counts only when **names BT** (`technician` field) and overlaps that BT's direct. No overlap → 0. Partial → proportional. Stays **BCBA billable** (type keys BT/BCBA split via `bucketOf`; no leakage to BT direct). BCBA+BT direct overlap = concurrent care, not double-book.
- **Per-client:** numerator = counting session × BT direct overlap (inferred or named), capped at session duration; denominator = client direct hours.
- **Per-RBT** (`computeTechCompliance`): denominator = ALL RBT directs; numerator = inferred-supervision overlap + named-on-session overlap. RBTs hit BOTH BACB 5% floor AND company target; non-RBT BTs hit company target only.
- **Completed appointments** never conflict (past event). Touching (end=next.start) don't overlap.
- **Insurer cap** (`supervisionMaxHoursPercent`, ~20%) = display warning only (orange, doesn't change green/yellow/red).
- **Deferred:** authorization-utilization, fieldwork hours.

## Phases (per QA discussions)

- Phase A — appointment lifecycle (complete/cancel with source + reason): done
- Phase B — compliance dashboard with per-client + per-tech: done
- Phase C — "find a spot" suggestion engine: not started
- Phase D — fieldwork hours tracking: deferred

## AI scheduling — "Fix It" vs "Wish It"

- **Fix It:** `ClaudeScheduler.generateSolutions(changedAppt, conflicts)` → conflict resolution (moves only), text-parsed.
- **Wish It:** Goal-driven rework (`src/wish.ts` + `WishComposer.tsx`). Structured NL composer (`WishRequest`: vacation/clearWindow/addRecurring/freeform + fields) keeps prompt compact. `generateWishSolutions` sends anonymized in-horizon schedule, asks **strict JSON ops** (move/add/remove/blackout). `parseWishSolutions` de-anonymizes **per-field** (never full string-replace → preserves ISO timestamps). `WishSolution` → `wishSolutionToDraft` (draft ops + blackouts): **Accept** commits all; **Customize** stages ops into draft tray (blackouts commit immediately). Pure logic unit-tested in `scripts/verify-wish.ts`. **AI safety:** Anonymization via anonymizer.ts + validation guard + token inspection. Compact appointment payload (id/start/end/type/client/tech/fixed/recur only).
