export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const PRESET_WINDOWS = {
    mornings: { start: '08:00', end: '12:00' },
    midday: { start: '10:00', end: '14:00' },
    evenings: { start: '15:00', end: '19:00' },
};
export const PRESET_LABELS = {
    mornings: 'Mornings 8–12',
    midday: 'Midday 10–2',
    evenings: 'Evenings 3–7',
};
// Combine overlapping/adjacent windows. Inputs are HH:MM strings, which
// compare lexicographically the same as chronologically.
export function mergeWindows(windows) {
    const valid = windows.filter(w => w.start < w.end);
    if (valid.length === 0)
        return [];
    const sorted = [...valid].sort((a, b) => a.start.localeCompare(b.start));
    const result = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const last = result[result.length - 1];
        if (sorted[i].start <= last.end) {
            if (sorted[i].end > last.end)
                last.end = sorted[i].end;
        }
        else {
            result.push({ ...sorted[i] });
        }
    }
    return result;
}
// Remove `target` from `windows`, splitting any window that fully contains it.
export function subtractWindow(windows, target) {
    const out = [];
    for (const w of windows) {
        if (target.end <= w.start || target.start >= w.end) {
            out.push({ ...w });
            continue;
        }
        if (target.start > w.start)
            out.push({ start: w.start, end: target.start });
        if (target.end < w.end)
            out.push({ start: target.end, end: w.end });
    }
    return out.filter(w => w.start < w.end);
}
// Whether the merged union of `windows` covers all of `target`.
export function unionContains(windows, target) {
    return mergeWindows(windows).some(w => w.start <= target.start && w.end >= target.end);
}
// A preset is "active" when every weekday's union covers the preset range.
export function isPresetActive(av, preset) {
    return WEEKDAYS.every(d => unionContains(av[d] || [], preset));
}
// Toggle a preset across weekdays: add (merge) or subtract.
// Weekend days and existing custom windows on weekdays are preserved as much
// as possible; toggling off a preset that was extended into a custom window
// will trim that window down to just the custom portion.
export function togglePreset(av, preset, on) {
    const next = { ...av };
    for (const d of WEEKDAYS) {
        const existing = next[d] || [];
        const updated = on
            ? mergeWindows([...existing, { ...preset }])
            : subtractWindow(existing, preset);
        if (updated.length === 0)
            delete next[d];
        else
            next[d] = updated;
    }
    return next;
}
//# sourceMappingURL=availabilityUtils.js.map