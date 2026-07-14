# Project Runtime Configuration & AI Rules

## 1. System CLI & Verification Protocol (IMPERATIVE RUNTIME)
Execute these exact verification scripts in order before outputting any code solutions.

### iOS Code Changes:
1. `swiftlint` (Enforce zero memory leaks and catch `[weak self]` omissions).
2. `xcodebuild -scheme [YourAppScheme] -destination 'platform=iOS Simulator,name=iPhone 15' build`
3. **Audit Rule:** Verify no plain-text `.xlsx`, cryptographic parsing, or unencrypted local logging routines leak into SwiftUI View templates.

### Cloudflare Worker Changes:
1. `npx tsc --noEmit` (Validate TypeScript structural integrity).
2. `npx wrangler dev` (Simulate local runtime authentication and data parsing loops).
3. **Audit Rule:** Review terminal stdout to ensure zero raw parameters or dynamic variables containing client data are printed.

## 2. Zero-Knowledge Cryptographic & Security Architecture
- **No Cleartext Transmission:** The backend API, hosting layers, and network logs must **never** receive, store, or transmit the cleartext user decryption key or unencrypted client data. 
- **Client-Side Encryption:** All data payloads must be completely encrypted using client-side AES-256 via Apple's `CryptoKit` on iOS *before* hitting any network interface or storage container (Cloudflare R2/KV).
- **Transient Memory Isolation:** When an Excel file is decrypted in-memory on the local device, all local variables and memory buffers must be forcefully wiped, cleared, or de-allocated immediately after the write/read block executes. Never cache unencrypted payloads to `tmp/` directories.
- **Active PHI Scrubbing:** Update this section as its logic is strengthened or breaches are encountered. Force structural regex or string-replacement sanitization wrappers on all error boundaries, catch statements, and logs. Instantly strip any strings matching patient identities and replace them with anonymized but internally-distinguishable `[SCRUBBED_TOKEN]`.

## 3. Code Design Patterns, Standards & Heuristics
- **Simplicity over cleverness:** Write readable, modular, scalable code. Avoid premature optimization. Optimally consolidate reused calls. plugin everything claude code "ecc" is available.
- **Reuse before reinvent:** Use existing libraries, frameworks, and patterns. Reuse with some confidence.
- **Non-negotiable guards (trump efficiency):**
- Data security: encryption, at-rest keys, access gates never bypass.
- AI tool safety: anonymization, validation, and prompt hardening stay strict.
- Compliance logic: BCBA-confirmed rules in `src/compliance.ts` and constraint validators are law.
- **workflow:** feature branches promote throuch dev and main branch. Unless specified differently for a repo: Code changes go to dev, then claude&user test, user confirms releaseclaude executes PR to main. Maintain dev environments. 
- **Ship fast:** Get to done. Iterate later unless requested. Refactor only when something breaks or explicitly requested.
- **Minimal diffs:** Every change earns its place. Limit to critical "while we're here" cleanups.
- **Strict Typing:** Avoid deviation from TypeScript frontend logic and Node.js backends. 
- **Error Handling:** Never swallow errors. Provide meaningful log traces (in dev, or in main/production when admin mode is enabled) and graceful fallbacks always.
- **Trust tech users:** Assume app users are semi-confident with tech. Don't explain clinical rationale; focus on UI clarity for scheduling/compliance decisions.
- **No TODOs:** Do not use `// TODO:` placeholders. Either implement the solution or leave an upgrade/note/comment on what's missing or out of scope.
- **The Repository Pattern:** The iOS SwiftUI layouts and the network routing endpoints must remain entirely decoupled from the file-system layout and cryptography mechanics.
- **Implementation Mapping:** Route all state operations through an abstract `SecureBehavioralRepository` protocol interface. The application core logic must only interact with high-level domain models (e.g., `BehaviorSession`, `TrialData`, `ABCData`). The repository implementation handles data storage in encrypted excel file, & allows easy swap to an enterprise data system later.
- **State Management:** Use modern Swift `@Observable` models or standard environment objects. Do not use global state variables or hardcoded user credentials.

### Swift / iOS Standards
- **Concurrency:** Use native `async/await` and Actors. Avoid legacy `DispatchQueue` unless strictly necessary.
- **Architecture:** Follow strict MVVM (Model-View-ViewModel) or Clean Architecture. No business logic in SwiftUI Views.
- **Memory Management:** Watch out for retain cycles. Always use `[weak self]` in escaping closures.

### Cloudflare Workers Standards
- **Runtime Limits:** Code must be optimized for execution within the 50ms CPU time limit (Bundled plan) or 10ms limit (Free plan).
- **Environment Variables:** Always use standard `env` bindings via `wrangler.toml`. Never hardcode secrets.
- **V8 Isolates:** Write stateless code. Do not rely on global variable persistence across Worker invocations.

## 4. Clinical & Regulatory Boundary Constraints (Compliance Guardrails)
- **Objective Metrics Only:** Automated clinical summaries, UI data trends, or textual reporting tools must exclusively output objective, observable, and measurable behavior data metrics (e.g., frequency, duration, rate, latency, antecedents, consequences).
- **Scope Restriction:** Never write code or logic text that attempts to diagnose, provide psychiatric evaluations, offer mental health counseling, or suggest pharmacological interventions. All workflows must sit strictly inside the  scope of clinical treatment under guidance of a BCBA/LABA.
- **Ethics Code Adherence:** All code paths must conform to the current BACB Ethics Code, prioritizing client privacy, confidentiality, and data minimization via the "Minimum Necessary" healthcare standard. Use pseudonyms "Supervising Behavior Analyst" for "BCBA" and "Credentialed BT" for "RBT" (registered trademarks)


## Collaboration Protocol

- **After completing any set of changes:** ask "Anything else, or should I open a PR / merge to dev?"
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.

## Git workflow

**Standard flow:**

1. Develop and commit on the `dev` branch.
2. `git push origin dev`
3. `gh pr create --base main --head dev`
4. `gh pr merge <n> --rebase --delete-branch=false`
5. `git fetch origin main` locally after merge.

Direct pushes to `main` are denied by the harness proxy (HTTP 403). `dev` → PR → merge is the only path. There is no separate staging/dev deployment — `dev` is a holding branch only; testing happens locally or on the iOS simulator before merging.

## Repo essentials

- **iOS build:** `npm run cap:ios` → vite build → `npx cap sync ios` → plist/version patch scripts. Don't track `dist-client/`. `scripts/sync-ios-version.cjs` keeps `MARKETING_VERSION` = package.json version; run `npm run ios:stamp` before every archive/upload (stamps a monotonic UTC build number — required once a stamped build has shipped).
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
- **xlsx is import/tooling-only.** The app's sole export is the encrypted envelope backup, named `<practiceName>_<YYYY-MM-DD>_<HHMM>.sassi` via `src/lib/backupFilename.ts` (legacy `.enc.json` backups still restore — imports are content-sniffed, never extension-routed). The plaintext `.xlsx` download was removed (PHI risk); `generateExcelFile` remains for import/migration/sample tooling.

## App lock & at-rest persistence (native only)

- **Lock gate:** Numeric PIN, **never stored**. Both `pin.verifier` (constant) and `schedule.enc` (ScheduleData) are AES-GCM, key PBKDF2-derived from PIN via `clientCrypto`. Correct PIN = decryption success. See `src/appLock.ts` + `src/secureStore.ts` (blobs in `Directory.Data`, namespaced `lock_*`). Cold launch only; web has no lock.
- **Lifecycle:** First launch → LockScreen "create" mode (PIN mandatory on native). Schedule re-encrypted every change (debounced 400ms) on unlock → only cross-launch persistence (no GET on mount).
- **Biometric:** `@aparajita/capacitor-biometric-auth` v9 (Capacitor 8 compatible). `src/biometric.ts` via `registerPlugin('BiometricAuth')` (no static import → web build safe). `getBiometryLabel()` maps iOS type (1=Touch, 2=Face) to UI. Opt-in stashes PIN under obfuscation (`pin.stash`) for biometric recovery — convenience/strength tradeoff, off by default. **Setup:** `npm install` → `npx cap sync ios` → add `NSFaceIDUsageDescription` to `ios/App/App/Info.plist` (Face ID requires it; Touch ID doesn't). **Note:** `@aparajita/capacitor-biometric-auth` was removed from `ios/App/CapApp-SPM/Package.swift` — native biometric will not link until restored via `npx cap sync`.
- **Claude API key:** Two paths: (1) **backup embed** — the `aiConfig` field of the encrypted `.sassi` envelope (app-obfuscated via `obfuscateKey`) restores settings on import; the xlsx `_Config` sheet is read on legacy import only (no longer written — xlsx export is gone); (2) **native at-rest** (`aiconfig.enc` blob via `saveAIConfig`/`loadAIConfig`, re-keyed on PIN change, cleared on lock clear). **Display:** Never shown after set ("🔒 API key is set" + Replace/Clear). Replace gated by `onRequestUnlock` (Face ID or PIN). Blank field on save = keep existing. Stores `schedulePassword` alongside for persistence across reinstalls.
- **Schedule password:** Reused as the backup-export password when it meets policy (backups are always encrypted). Never re-displayed; stored encrypted at rest. Changing requires current password (gate).
- **AutoFill:** Schedule-decrypt prompt is real `<form>` (`PasswordPrompt.tsx`, `autocomplete="current-password"`) for iOS AutoFill support.

## Compliance rules (BCBA-confirmed; do not re-derive)

- **Supervision credit = BT direct time-overlap** (`countsAsSupervision`). Counting types: supervision, parent-training, case-planning, **and reassessment**. **Supervision** (client present) → BT **inferred**, credit any overlap with that client's directs. **PT/CoC/reassessment** → counts only when **names BT** (`technician` field) and overlaps that BT's direct (reassessment counts when the BT is present and assisting — e.g. data collection while the BCBA runs an assessment tool; BCBA-confirmed). No overlap → 0. Partial → proportional. Stays **BCBA billable** (type keys BT/BCBA split via `bucketOf`; no leakage to BT direct). BCBA+BT direct overlap = concurrent care, not double-book.
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
