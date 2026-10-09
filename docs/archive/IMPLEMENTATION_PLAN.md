# SAssi UI / behavior changes — implementation status

Branch: `claude/gallant-pascal-gashiq`

Status legend: ✅ done · 🔲 not started

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Authorizations panel copy cleanup (drop intro paragraph, shorten weekly-rates gloss, sweep em dashes) | ✅ | `AdminPanel.tsx` `AuthsTab`/`AuthCard`, `SettingsEditor` |
| 2a | Relabel "Manual hours" → "Prior hours used in auth (prior / outside SAssi, and not imported)" | ✅ | `AdminPanel.tsx` `AuthCard` |
| 2b | Remove/End-cliff buttons no longer overlap on phone | ✅ | `AuthCard` top row (Remove moved to its own row, date fields get `flex-basis`/`min-width`) |
| 2c | Auths render as collapsible rows, newest first | ✅ | new `AuthRow` wrapper; `AuthsTab` sorts desc by `startDate` |
| 2d | Both report dates internal + computed from company policy (lead before auth end) | ✅ | new `ReportLead` type + `computeReportDates()` in `authorization.ts`; `CompanySettings.reportDraftLead`/`reportFinalLead`; `LeadField` in Settings; `AuthCard` shows computed "Initial draft due"/"Final draft due" |
| 2e | Compliance review copy replaced | ✅ | `ComplianceDashboard.tsx` `PastIncomplete` |
| 2f | Correction-engine guardrails (future-only; never steal a booked session; flag joint BT+BCBA windows) | ✅ | `corrections.ts` (`computeShaveRoom` future-only, `findOpenSlots` skips past-of-today, `CorrectionFlag` + `buildJointWindowFlags`), `claudeScheduler.ts` prompt constraints, surfaced in `CaseloadView.tsx` |
| 3 | Month calendar Monday-start, Sunday rightmost, week totals across rollovers | ✅ | `Calendar.tsx` (`weekStartsOn: 1` everywhere, header reorder, Sunday-cell gate now `dow === 0`) |
| 4 | Week view half/quarter-hour gridlines + frozen time axis | ✅ | `Calendar.tsx` `TimeGrid` (`GridLine`, sticky axis/header spacer) |
| 5 | Week density + client/staff color coding + legend + tap dialog + Day view | ✅ | `calendarColors.ts`; `TimeGrid` (shared by Week & Day), `TileLegend`, tap dialog, `blockLook`; parent gains `day` view + nav |
| 6 | Appointment form: auth-default duration + "move end with start" checkbox | ✅ | `AppointmentForm.tsx` (`TYPE_TO_WEEKLY`, `applyAuthDefaultEnd`, `moveEndWithStart`) |
| 7 | Compliance "Complete" lets you adjust actual times | ✅ | `ComplianceDashboard.tsx` `PastIncompleteRow` inline time editor → `onMarkComplete` with adjusted times |

## Ground rules applied
- Trimmed explanatory/teaching microcopy in the auth panel and compliance review.
- Swept em dashes from visible strings in every file touched (replaced with periods/commas/parentheses; idiomatic placeholder dashes like `— Pick —` left intact).

## Verification
- `npm run build` clean (tsc + vite).
- `scripts/verify-casemodel.ts` 22/22, `verify-draft.ts` 10/10, `verify-excel.ts` 16/16.
  - Dev fixtures updated for the new rules: report dates derive from the auth end date, and **past** supervision sessions are no longer offered for shaving (you can't fix the past), so the shave-room fixture uses a future session.

## Still to do
- Manual sanity check on the iPhone simulator per CLAUDE.md / HANDOFF.md (not runnable here).
