/**
 * Resolve which SAssi dock presentation to use from the two width breakpoints
 * the shell already tracks (`compactRail` = useMaxWidth(639), `showDock` =
 * useMinWidth(1024)). Three bands, no gaps:
 *
 * - `sheet`  — phones (≤639px): a FAB-triggered slide-up sheet.
 * - `chip`   — tablet-portrait (640–1023px): a collapsible top-right chip that
 *              rolls open over the right side, so the main column stays full
 *              width and the calendar toolbar/lens buttons aren't clipped.
 * - `column` — desktop (≥1024px): the permanent side-by-side 340px column.
 *
 * `compactRail` is checked first so a phone always yields `sheet` even if a
 * misconfigured breakpoint pair set both flags.
 */
export type DockMode = 'sheet' | 'chip' | 'column';

export function resolveDockMode({
  compactRail,
  showDock,
}: {
  compactRail: boolean;
  showDock: boolean;
}): DockMode {
  if (compactRail) return 'sheet';
  if (showDock) return 'column';
  return 'chip';
}
