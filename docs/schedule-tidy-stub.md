# Feature stub: sAssI "Tidy / Doctor a schedule"

> Status: **STUB — not started.** Kickoff notes for a fresh context. Do not treat any
> section as decided; the first job in the new context is to explore the codebase and
> turn this into a real plan (with the plan workflow) before writing code.

## The ask (in the user's words)

> Ask sAssI needs to be able to fix a schedule. Maybe I've been working on it through
> rounds of dev and there are split sessions and other noise and nonsense for it to
> doctor up to make a "clean" version that **doesn't semantically change the schedule**
> but looks for weirdness — e.g. split sessions that represent one contiguous session,
> a pattern of non-recurring sessions that fit a pattern and can be made into a recurring
> group for easier admin. What else might it need to do to remedy a schedule that has
> been working through rounds of dev?

## Non-negotiable guardrail: SEMANTIC EQUIVALENCE

The tidy pass must produce a schedule that is **behaviorally identical**, only tidier.
Define equivalence concretely and ASSERT it before allowing apply (refuse/flag otherwise):

- Per client & per tech: identical total direct hours per day and per week.
- Identical supervision / PT / reassessment **credit** (same overlaps with the same
  directs — see the compliance rules in CLAUDE.md; credit is fragile, don't perturb it).
- Identical actual time coverage (the union of covered intervals is unchanged).
- Compliance metrics unchanged: run `computeClientCompliance` / `computeTechCompliance`
  (src/compliance.ts) before and after and diff — must be equal.
- Statuses preserved: completed / canceled / cancellation records / makeup links intact.
- BCBA travel feasibility preserved (see the travel feature — don't create sub-travel-gap
  adjacencies; `dropInfeasibleTravelOps` in src/wish.ts).

Anything that would change these is NOT a tidy op — surface it as a *suggestion/warning*,
never an automatic edit.

## Candidate tidy operations

**User-named (must-have):**
1. **Merge contiguous fragments** — same client + tech + type + fixed-ness, touching or
   trivially-gapped in time (end == next.start), non-canceled → one session. (Watch: don't
   merge across a real gap, across different techs, or where a fragment carries distinct
   credit.)
2. **Consolidate a recurring pattern** — N non-recurring sessions at the same weekday /
   time / client / tech / type across consecutive weeks → one recurring series
   (`seriesId` + `recurringPattern`) for easier admin. ⚠️ CRUX: the app's rule is *nothing
   expands recurrence* — the builder MATERIALIZES dated rows and treats recurring as a
   template. Collapsing dated occurrences into a recurring template must not lose or
   duplicate occurrences. Confirm exactly how recurring sessions render/materialize before
   designing this (this is the highest-risk op).

**Brainstormed additions (vet each for the equivalence guardrail):**
3. De-duplicate exact duplicates — identical overlapping sessions from repeated builder runs.
4. Drop degenerate sessions — zero/negative duration (end <= start), empty ghosts.
5. Orphan cleanup — sessions referencing a deleted client/tech; dangling `makeupForId`.
6. seriesId hygiene — regroup occurrences that clearly belong to one series but have
   missing/inconsistent `seriesId`; flag a series with a drifted occurrence.
7. Recurring-pattern sanity — a "weekly" series with silent missing weeks (surface gaps);
   biweekly mislabeled weekly.
8. Blackout/timeoff hygiene — merge overlapping/duplicate blackouts for the same entity+date.
9. Fixed-flag hygiene — sessions accidentally left fixed/unfixed (suggest, don't force).
10. Cosmetic normalization (safe) — canonical titles, stable ordering for clean diffs.
11. **Suggestion-only (semantic — never auto):** near-adjacent sessions that could merge but
    have a real gap; odd timestamps (16:03) that could snap; overlaps that look like a
    double-book. These go to a "review" list, not the auto-apply set.

Each rule should be independently toggleable and emit ops + a human rationale.

## Likely shape (validate, don't assume)

- Prefer a **deterministic local analyzer** (like src/corrections.ts / the builder) that
  emits `WishOp`s (move/remove/add/edit) + rationales, NOT a raw AI call. sAssI can *narrate*
  the tidy, but the edits should be deterministic and testable.
- Surface through the **existing propose → preview draft → accept** pipeline
  (`stageSassiOps` / `wishSolutionToDraft` in src/app.tsx + src/wish.ts) so the user reviews
  a before/after before committing. Show a "semantic equivalence ✓ verified" badge; block
  apply if the equivalence check fails.
- New pure module (e.g. `src/tidy.ts`) + `scripts/verify-tidy.ts` following the repo's
  verify-script harness. Reuse: src/intervals.ts (adjacency/merge), the `seriesId` /
  `recurringPattern` model in src/types.ts, src/compliance.ts (equivalence check), src/draft.ts.

## Reuse / grounding pointers
- Op model + apply: `src/wish.ts` (WishOp, wishSolutionToDraft, dropPastOps,
  dropInfeasibleTravelOps), `src/draft.ts` (applyOps), `src/app.tsx` (stageSassiOps).
- Deterministic engines to mirror: `src/scheduleBuilder.ts`, `src/corrections.ts`,
  `src/builderBcba.ts` (occupancy/adjacency), `src/intervals.ts`.
- Equivalence oracle: `src/compliance.ts`, `src/caseModel.ts`.
- Recurring/materialization semantics: `src/builderBcba.ts` (materialization),
  `src/scheduleBuilder.ts`; note CLAUDE.md "nothing expands recurrence."
- Anonymization boundary if any AI narration is added: `src/anonymizer.ts`,
  `src/claudeScheduler.ts` (sAssI chat runs in token space; the month-builder runs on the
  REAL schedule locally — a tidy pass is the same category and should run locally).

## Open questions to resolve first
1. Exact recurring/materialization semantics — can dated occurrences be losslessly folded
   into a recurring series and back? (Gates op #2.)
2. What is the authoritative equivalence check — is compliance-metric equality sufficient,
   or do we also need interval-coverage equality per entity? (Recommend both.)
3. Auto-apply set vs. review-only set — which rules are safe to apply silently vs. which
   only ever suggest?
4. Entry point — a "Tidy schedule" action in the sAssI dock, and/or a `WishRequest` kind?
5. Scope — whole schedule vs. in-horizon only vs. a selected date range?

## First moves in the new context
- Run the plan workflow: Explore agents over the op-apply pipeline, the recurring/
  materialization model, and the compliance equivalence oracle — THEN plan, THEN build.
- Confirm the equivalence definition and the recurring-consolidation feasibility before
  committing to op #2.
