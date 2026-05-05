# ABA Schedule Assistant — Handoff for Next Worker

## Context
Capacitor-wrapped React + Express ABA scheduling app running on Kaleb's iPhone (Xcode iOS Simulator, iPhone 17 Pro). Active feature branch: **`claude/schedule-assistant-ai-app-tWVZ6`**. Both the feature branch and **`main`** are kept in sync — Kaleb pulls `main` on his Mac.

Repo layout:
- React frontend in `src/components/` + `src/app.tsx`
- Express backend in `src/server.ts`
- Shared types in `src/types.ts`
- Excel I/O in `src/excelHandler.ts`, validator in `src/constraintValidator.ts`
- Capacitor iOS project lives in `ios/` (not in this repo's source — present on Kaleb's Mac)

## Build cycle (on Mac)
```bash
git pull origin main
npm install                 # only if package.json changed
npm run build:server        # tsc
npm run build:client        # vite build
npx cap sync ios            # copy web assets + sync plugins
# Then ⌘R in Xcode
```

## What's already done in this session

### Major UX work this turn
- **AvailabilityGrid rotated** (`src/components/AvailabilityGrid.tsx`): days are now rows, hours are columns. Grid is ~250px tall instead of ~1280–1900px. Has snap toggle (15/30/60m, default 30m), Weekdays 9-5 / Copy Mon → Tue-Fri / Clear all chips, and an always-visible per-day type-able editor below. Preserves the `clinicianAvailability` prop and uses it for initial horizontal scroll position.
- **Weekend hidden by default** in `DayAvailabilityRow` with a "Show weekend" checkbox; auto-shows when existing data has Sat/Sun.

### Earlier this session
- iOS download via Capacitor Filesystem + Share plugins (was silently a no-op via `<a download>` in WKWebView). See `handleDownload` in `src/app.tsx`.
- AdminPanel: technicians editable (availability + name + RBT toggle), clients editable (availability + parent-training max), add/remove buttons, all persisted via the API.
- Server: added create/delete endpoints for technicians, clients, appointments.
- SetupWizard: per-case parent-training cap on clients; clinician availability section at the top of the company step.
- Per-case parent-training validation: `Client.parentTrainingMaxHours` is a hard cap; if cap < company minimum, the cap becomes the effective floor too (no false low-target warnings for capped cases).
- Calendar appointment click → side panel with Edit/Delete buttons that open `AppointmentForm` in edit mode.
- SolutionPanel: amber warning banner when a solution spans multiple weeks.
- iPhone scroll fixes: html/body/#root locked to 100vw, overflow-x: hidden, viewport-fit=cover, Calendar padding `clamp(8px, 3vw, 24px)`.
- `.gitignore` added (was missing — accidentally committed `node_modules` once; cleaned up in `00d524b`).

## Pending — your work

### 1. Port DayAvailabilityRow vertical-stack layout from `claude/improve-calendar-input-RyhnP`
The "Show weekend" checkbox is a stopgap. The cleaner fix from that branch is a vertical stack — one row per day with `flex-wrap` time inputs. Naturally fits all 7 days on a phone, no overflow.

**Reference**: `git show 45837fe:src/components/SetupWizard.tsx` — look for `function DayAvailabilityRow`.

**Port plan**:
- Replace the 7-column grid with a vertical stack of day rows.
- Change `DayAvailabilityRowProps.onChange` to `(availability) => void` (single full-map callback).
- Add chip bar: Weekdays 9–5, Copy Mon → Tue-Fri, Clear all.
- Each day row: day label + window time inputs + `+ window` + `Off` button (when populated).
- Drop the "Show weekend" checkbox — vertical layout handles it.
- Update SetupWizard call sites (3 places: clinician availability, clients step, technicians step) to use the new signature.
- Drop the now-redundant `setDayAvailability` helper and `updateWindowsForDay` extraction from SetupWizard — they exist only because of the per-action callback signature.

### 2. Add chip buttons to AdminPanel's `AvailabilityEditor`
Currently the inline editor in AdminPanel (used by both `ClientCard` and `TechnicianCard`) only has the per-day window controls. Add the same "Weekdays 9–5", "Copy Mon → Tue-Fri", and "Clear all" chip bar at the top of the editor.

**Reference**: `git show 45837fe -- src/components/AdminPanel.tsx`.

### 3. Verify on iPhone
After 1 + 2, build and check:
- Wizard "Clinician availability" section: vertical day rows, no horizontal overflow.
- Grid view in clients/tech steps: grid + type-able editor render and scroll horizontally.
- AdminPanel: edit a tech's availability, save persists across navigations.
- Download still works (Capacitor share sheet on native).

## Don't break
- **Anonymizer must still scrub PII before any Claude call** — see `src/anonymizer.ts`. Don't add fields to the Claude prompt without considering anonymization.
- **API keys are NEVER stored server-side**. Per-request `X-Claude-Api-Key` header only.
- **Capacitor iOS build**: don't add Node-only APIs to client code. The Capacitor packages we depend on are `@capacitor/core`, `@capacitor/filesystem`, `@capacitor/share`. `@capacitor/storage` was an obsolete leftover and was removed.
- **Server has a pre-existing ESM/`__dirname` bug** in `src/server.ts:21`. Compiled `dist/server.js` won't start (`__dirname is not defined in ES module scope`). Not in this scope; flag if someone needs to deploy.

## Branch / push instructions
```bash
git add -A
git commit -m "..."
git push origin claude/schedule-assistant-ai-app-tWVZ6
git push origin claude/schedule-assistant-ai-app-tWVZ6:main
```
Both branches must end up at the same commit.

## Useful refs
- Other branch with the rotated layout: `claude/improve-calendar-input-RyhnP` — only one commit ahead of `3a3cdda` (`45837fe`). The AvailabilityGrid changes are already ported to `main`; only DayAvailabilityRow + AdminPanel chip buttons remain.
- Latest commit on `main`: `16b7d33`.
