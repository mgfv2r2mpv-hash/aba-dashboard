// Anonymization layer for PII protection.
//
// Even when a user enters real names ("John Doe") into the schedule,
// no identifiable string is allowed to leave this server toward Claude.
// We replace every name and free-text field with opaque tokens before
// any external API call, then restore the originals when applying results.
//
// Tokens used:
//   CLIENT_<n>   for client identifiers
//   TECH_<n>     for technician identifiers
//   APT_<n>      for appointment identifiers
//
// Free-text fields (title, description, notes) are scrubbed: any token
// resembling a real name is removed entirely. We only keep enums (type,
// recurringPattern), times, booleans, and numbers.
export function buildAnonymizationMap(data) {
    const map = {
        clients: new Map(),
        technicians: new Map(),
        appointments: new Map(),
        reverse: new Map(),
    };
    data.clients.forEach((c, i) => {
        const token = `CLIENT_${i + 1}`;
        map.clients.set(c.id, token);
        map.clients.set(c.name, token);
        map.reverse.set(token, c.name);
    });
    data.technicians.forEach((t, i) => {
        const token = `TECH_${i + 1}`;
        map.technicians.set(t.id, token);
        map.technicians.set(t.name, token);
        map.reverse.set(token, t.name);
    });
    data.appointments.forEach((a, i) => {
        const token = `APT_${i + 1}`;
        map.appointments.set(a.id, token);
        map.reverse.set(token, a.id);
    });
    return map;
}
// Strip free-text fields entirely - we cannot trust them to be PHI-free.
// We only keep structured/enum fields that the scheduler actually needs.
function scrubAppointment(a, map) {
    return {
        id: map.appointments.get(a.id) || `APT_unknown`,
        technician: a.technician ? (map.technicians.get(a.technician) || 'TECH_unknown') : null,
        client: a.client ? (map.clients.get(a.client) || 'CLIENT_unknown') : null,
        startTime: a.startTime,
        endTime: a.endTime,
        isFixed: a.isFixed,
        isBillable: a.isBillable,
        type: a.type,
        isRecurring: !!a.isRecurring,
        recurringPattern: a.recurringPattern || null,
        // NOTE: title, description, notes intentionally omitted to prevent PHI leakage
    };
}
function scrubTechnician(t, map) {
    return {
        id: map.technicians.get(t.id) || 'TECH_unknown',
        isRBT: t.isRBT,
        assignments: t.assignments.map(a => ({
            clientId: map.clients.get(a.clientId) || 'CLIENT_unknown',
            hoursPerWeek: a.hoursPerWeek,
            billable: a.billable,
        })),
        availability: t.availability,
        // NOTE: name and notes intentionally omitted
    };
}
function scrubClient(c, map) {
    return {
        id: map.clients.get(c.id) || 'CLIENT_unknown',
        availabilityWindows: c.availabilityWindows,
        // NOTE: name and notes intentionally omitted
    };
}
export function anonymizeSchedule(data, map) {
    return {
        technicians: data.technicians.map(t => scrubTechnician(t, map)),
        clients: data.clients.map(c => scrubClient(c, map)),
        appointments: data.appointments.map(a => scrubAppointment(a, map)),
        settings: data.settings,
    };
}
export function anonymizeAppointment(a, map) {
    return scrubAppointment(a, map);
}
// Scrub a free-text string of any names that appear in the schedule.
// This is a defensive pass for conflict messages built from user data.
export function scrubText(text, data, map) {
    let result = text;
    // Replace longest names first so "John Smith" beats "John"
    const replacements = [];
    data.clients.forEach(c => {
        if (c.name)
            replacements.push({ from: c.name, to: map.clients.get(c.name) || 'CLIENT_X' });
    });
    data.technicians.forEach(t => {
        if (t.name)
            replacements.push({ from: t.name, to: map.technicians.get(t.name) || 'TECH_X' });
    });
    replacements.sort((a, b) => b.from.length - a.from.length);
    for (const { from, to } of replacements) {
        if (!from)
            continue;
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'gi'), to);
    }
    return result;
}
// De-anonymize tokens in a string back to original values.
export function deAnonymizeText(text, map) {
    let result = text;
    // Replace longest tokens first
    const tokens = Array.from(map.reverse.keys()).sort((a, b) => b.length - a.length);
    for (const token of tokens) {
        const original = map.reverse.get(token);
        if (original) {
            result = result.replace(new RegExp(token, 'g'), original);
        }
    }
    return result;
}
//# sourceMappingURL=anonymizer.js.map