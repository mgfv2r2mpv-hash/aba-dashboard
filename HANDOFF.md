# ABA Schedule Assistant — Handoff for Next Worker

## Context
This is a Capacitor-wrapped React + Express ABA scheduling app currently running on the user's iPhone (iOS Simulator via Xcode). The user (Kaleb) tested the wizard flow and reported issues. Some are fixed; the rest are queued.

The app branch is `claude/schedule-assistant-ai-app-hJkiS`. The user previously asked us to push to `main`, so both branches should be kept in sync when you finish.

## What's already done in this commit

### Type system overhaul (BREAKING)
`src/types.ts` now has a flexible `parentTraining` shape that replaces the old `parentTrainingHoursPerMonth`:
```ts
parentTraining: {
  minimumHours: number;
  targetMinHours: number;
  targetMaxHours: number;
  periodUnit: 'week' | 'month' | 'sixMonths' | 'year';
}
```
The legacy `parentTrainingHoursPerMonth` field is kept as optional for backward-compat reading of old Excel files but is no longer written.

Also exported: `BACB_RBT_SUPERVISION_MIN_PERCENT = 5` constant.

All consumers updated: `excelHandler.ts`, `constraintValidator.ts`, `claudeScheduler.ts`, `AdminPanel.tsx`, `SetupWizard.tsx`, `createSampleData.ts`.

### Multi-window availability in Excel
`excelHandler.ts` now reads/writes a `${day}Windows` JSON-encoded column for arrays of windows. The legacy `${day}Start`/`${day}End` columns still parse for backward compat. **The UI does not yet expose multi-window editing — that's task #3 below.**

### White-screen fix (partial)
`src/app.tsx` dashboard layout now uses `flex-wrap` and conditionally renders the side panel only when there are conflicts/solutions/selectedAppointment. This fixes the white screen on iPhone when the wizard completes (previously the 350px side panel ate the entire viewport).

### Header is responsive
`src/app.tsx` header now wraps and uses smaller padding/font on mobile.

### Modal width is responsive
`src/components/SetupWizard.tsx` modal is now `width: min(720px, 95vw)` instead of fixed 720px. Fixes wizard cut-off on iPhone.

### Parent training period selector
`src/components/SetupWizard.tsx` now has a period unit dropdown (week/month/6mo/year). User reported this was needed because some funders set targets like "max 24h/6mo" or "max 1h/wk".

### Removed Excel-specific copy
Welcome step no longer mentions "encrypted Excel file".

## What's still pending — your work

These are all in the user's feedback. Read it carefully (full feedback in conversation history of session `241d66d0-d265-4936-91ef-327c256b7c45.jsonl`):

### 1. Supervision % field cannot clear "0" default
**File**: `src/components/SetupWizard.tsx`, the company step.

**Problem**: When user backspaces to empty the field, `parseFloat(e.target.value) || 0` forces it to `0`, and you can't delete the `0`. The user has to type a digit BEFORE backspacing the 0 or they get stuck typing "010" etc.

**Fix**: Use string state for these fields, parse to number only on save. Pattern:
```ts
const [supDirectStr, setSupDirectStr] = useState('5');
// in input:
value={supDirectStr}
onChange={(e) => setSupDirectStr(e.target.value)}
// on Next/save:
const supDirect = parseFloat(supDirectStr) || 0;
```
Apply to all numeric inputs in the wizard (supervision %, parent training hours, target min/max, technician assignment hours).

### 2. RBT supervision % is a BACB global, not per-company
**File**: `src/components/SetupWizard.tsx`, company step.

**Behavior**: The 5% RBT supervision minimum is set by the BACB, not the company. Show it as a fixed value with a note explaining it's BACB-mandated. Allow override (some companies exceed the minimum) but make the override explicit (checkbox: "Override BACB minimum").

Use the `BACB_RBT_SUPERVISION_MIN_PERCENT` constant from `types.ts`.

### 3. Multiple availability windows per day (Client + Tech wizards)
**Files**: `src/components/SetupWizard.tsx` — `DayAvailabilityRow` component.

**Problem**: Some clients have split availability like "11am-1pm, 3pm-6pm". Current UI only supports one window per day. The data model already supports `TimeWindow[]` (it's an array) and the Excel handler now round-trips it via the `${day}Windows` column. Just need UI.

**Suggested UI**: Within each day cell, list each window as a row with start/end inputs and a remove (×) button, plus a "+ window" button below.

### 4. Drag-select schedule grid (NEW component)
**Files**: New component, used in both client and technician steps of `SetupWizard.tsx`.

**User's request (verbatim)**: "What about a calendar widget click and drag to select 15-min chunks, and then a text field to refine beyond the 15 minute mark?"

**Spec**:
- 7-column × 96-row grid (7 days, 24 hours × 4 fifteen-minute slots)
- Mouse/touch drag selects a range; second drag deselects (or shift-drag deselects)
- Selection produces a `TimeWindow[]` per day
- After drag-select, show editable HH:MM text inputs to refine to the minute
- Should also work on touch (this runs on iPhone)
- Also user request: "Need a way to set multiple days at once" — consider a "copy Mon to all weekdays" or column-header click-to-select-all-day

This is the biggest piece. Consider extracting to `src/components/AvailabilityGrid.tsx`. The current `DayAvailabilityRow` per-day input can be kept as an alternative compact view.

### 5. Technician assignment text field is unclear
**File**: `src/components/SetupWizard.tsx`, technician step, the `+ Assignment` row.

**Problem**: User saw a text field with "0" next to a client picker and didn't know what it was. It's the `hoursPerWeek` field. Add a label "Hours/wk" above or change the placeholder text to be unmistakable.

### 6. iOS overall polish
- The wizard renders fine now after the responsive fix, but verify on iPhone 17 Pro simulator.
- Check the technician step modal — user noted "Modal looks bad" with a screenshot showing content cut off on the right.
- Bottom navigation buttons (Back / Next / Create Dashboard) should stay visible — currently they may scroll out of view on long content; consider sticky footer.

## How to test

```bash
# from repo root
npm run build:server  # tsc
npm run build:client  # vite build
npx cap sync ios      # copy to iOS project
# then in Xcode press Play to run on simulator
```

If you change React code, `npm run build:client && npx cap sync ios` is the cycle. The user is using iPhone 17 Pro simulator.

## Compliance answer the user asked

The user genuinely asked: "Do they need to use anonymized if encrypted and backend anonymized too?"

The answer (already given in chat): **Yes**, because:
1. Defense in depth — anonymizer + encryption are safety nets, not primary defense
2. HIPAA Safe Harbor de-identification is automatic if no real identifiers are entered
3. Minimum-necessary disclosure rule
4. Decrypted data still sits in browser memory, exposed via screenshots/screen-share

The wizard copy now says "Use anonymized identifiers (e.g. 'Client A') — never enter real names."

## Branch / push instructions

The user expects the result on `main` so they can pull on their Mac. After your work:

```bash
git add -A
git commit -m "..."
git push origin claude/schedule-assistant-ai-app-hJkiS
git push origin claude/schedule-assistant-ai-app-hJkiS:main
```

## Don't break

- The anonymizer must still scrub all PII before any Claude call. Don't add new fields to the prompt without considering anonymization.
- The Capacitor iOS build must keep working. Don't add Node-only APIs to client code.
- API keys are NEVER stored server-side. Per-request headers only.
