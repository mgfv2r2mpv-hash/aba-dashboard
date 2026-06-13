// Stable per-entity colors for the week / day calendar tiles. A tile's
// background is a pastel keyed to the CLIENT; diagonal candy-stripes in a bold
// color are keyed to the BT/staff. Colors are derived by hashing the name so
// they stay consistent across renders and weeks.
const CLIENT_PASTELS = [
    '#dbeafe', '#dcfce7', '#fef9c3', '#fae8ff', '#ffe4e6',
    '#cffafe', '#fed7aa', '#e0e7ff', '#d1fae5', '#fce7f3',
];
const STAFF_BOLDS = [
    '#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626',
    '#0891b2', '#ea580c', '#4f46e5', '#059669', '#db2777',
];
function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}
export function clientPastel(name) {
    if (!name)
        return '#e5e7eb';
    return CLIENT_PASTELS[hash(name) % CLIENT_PASTELS.length];
}
export function staffBold(name) {
    if (!name)
        return '#6b7280';
    return STAFF_BOLDS[hash(name) % STAFF_BOLDS.length];
}
// CSS for a tile: client pastel base, with bold diagonal stripes for the staff
// member overlaid when a technician is assigned (supervision / BCBA-lens items
// carry no technician and so render as the plain client pastel).
export function tileStyle(clientName, techName) {
    const pastel = clientPastel(clientName);
    if (!techName)
        return { backgroundColor: pastel };
    const stripe = staffBold(techName);
    return {
        backgroundColor: pastel,
        backgroundImage: `repeating-linear-gradient(45deg, ${stripe}40 0, ${stripe}40 6px, transparent 6px, transparent 12px)`,
    };
}
// CSS for a legend swatch showing a staff member's stripes on a white square.
export function legendStripeStyle(techName) {
    const stripe = staffBold(techName);
    return {
        backgroundColor: 'white',
        backgroundImage: `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 3px, transparent 3px, transparent 6px)`,
    };
}
//# sourceMappingURL=calendarColors.js.map