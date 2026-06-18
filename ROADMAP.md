# Feature Roadmap

Upcoming goals logged for future development. These are **not in scope** for the current refactor.

---

## 1. Schedule Audit View

A read-only overlay on the calendar that highlights clients and sessions against their targets/goals.

- Red = above authorization cap or compliance ceiling
- Amber = approaching boundary
- Green = on track
- Gray = no target set

Triggered from the compliance dashboard or as a toggle on the main calendar. No AI call required — pure derived state from existing `computeClientCompliance` / `computeTechCompliance`.

---

## 2. Session Trim / Add Suggestions (in-app algo, no AI)

After the audit view highlights over/under-served cases, surface a quick-action panel:

- **Trim suggestions**: find supervision sessions that can be shortened toward the compliance floor without dropping below BACB 5% or company target. Show the BCBA exactly what to cut and by how much.
- **Add suggestions**: identify the best open windows to slot in supervision or PT for under-served cases. Precompute from `buildSupervisableWindows` / `buildComplianceFillContext`.
- **Local solve button**: run `solveComplianceFill` (already written in `src/localSolver.ts`) as a zero-API "Quick Fix" before invoking Claude, so the BCBA gets an instant baseline.

---

## 3. New Client Feasibility Analysis ("Can I add this client?")

An interactive tool where the BCBA enters:
- Proposed client's availability windows
- Authorized direct hours per week
- Preferred tech(s)

The tool runs against the current schedule and reports:

- **Capacity**: does any tech have room within their available hours?
- **BCBA supervision load**: will adding this client push BCBA billable hours over goal? What's the projected supervision gap?
- **Schedule fragility score**: how much does adding this client increase the probability of a cascade (cancellation affecting compliance across multiple cases)?
- **Clinical rationale**: plain-language summary of why this is workable or unworkable, formatted for a clinical decision. Example: "Adding [client] at 10h/week on Mon/Wed/Fri would push BCBA billable to ~52h/week (+8%) and requires ~2h/week supervision. Technician capacity is sufficient but leaves no buffer. Risk: any cancellation in weeks 2–3 would likely push two existing cases below the compliance floor."
- **Solutions if borderline**: 1–2 concrete adjustments (shift existing sessions, trim an over-served case) that would make it work.

Entry point: a button in the client management section of AdminPanel, or from the "Add Client" form.

---

## 4. Caseload Stress Analysis Tool

An interactive tool for the BCBA to manually massage the schedule and see real-time feedback:

- **Drag a compliance slider** per client to simulate what happens if that client cancels more (or less) than expected.
- **"What if" mode**: temporarily mark sessions as canceled or incomplete to see the cascade effect on compliance across all cases.
- **Load meter**: running tally of BCBA billable hours, supervision load, and any cases at risk as changes are made.
- **Revert button**: return to the current schedule state without committing changes.

This is distinct from the existing draft/DraftTray system — it is a simulation/analysis surface, not an edit pipeline. Changes in stress-analysis mode should never flow into the live schedule without explicit confirmation.

---

## 5. Wish It — Expanded Request Types

Extend `WishKind` in `src/types.ts` to support:

- `'auditSchedule'`: ask Claude to review the schedule for sessions above/below targets and produce a JSON list of flagged items with clinical rationale. Result shown as an annotated calendar overlay.
- `'newClientFeasibility'`: pass proposed client params, ask Claude to evaluate load/fragility and return a structured `FeasibilityReport` (workable | borderline | unworkable, reasons, suggested adjustments).

Both require a new response schema (not `WishSolution` ops) and likely a new parser in `wish.ts`.

---

## Technical Debt / Notes

- `src/localSolver.ts`: greedy compliance fill, not yet wired to any UI. Good candidate for the "Quick Fix" button in item 2 above.
- `src/qc.ts`: schedule validation diff tool, not yet used. Useful for validating local solver output before presenting to the BCBA.
- `ClaudeModel` is defined in both `src/components/Settings.tsx` and `src/claudeScheduler.ts` as identical types. Consolidate into a single source of truth when touching either file.
