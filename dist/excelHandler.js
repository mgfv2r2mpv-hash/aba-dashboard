import * as XLSX from 'xlsx';
import { AUTH_BUCKETS } from './types';
import { v4 as uuidv4 } from 'uuid';
export function parseExcelFile(filePath) {
    return parseWorkbook(XLSX.readFile(filePath));
}
export function parseWorkbook(workbook) {
    const clients = parseClients(workbook);
    const technicians = parseTechnicians(workbook);
    const settings = parseSettings(workbook);
    const appointments = parseAppointments(workbook);
    const blackouts = parseBlackouts(workbook);
    const authorizations = parseAuthorizations(workbook);
    const manualUsage = parseManualUsage(workbook);
    const embeddedConfig = parseEmbeddedConfig(workbook);
    return {
        data: {
            id: uuidv4(),
            version: 1,
            clients,
            technicians,
            settings,
            appointments,
            blackouts,
            authorizations,
            manualUsage,
            lastModified: new Date().toISOString(),
        },
        embeddedConfig,
    };
}
function parseAuthorizations(workbook) {
    const sheet = workbook.Sheets['Authorizations'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data
        .filter(row => row && row.clientId && row.startDate && row.endDate)
        .map((row) => {
        const buckets = {};
        for (const { key } of AUTH_BUCKETS) {
            const v = parseFloat(row[key]);
            if (Number.isFinite(v) && v > 0)
                buckets[key] = v;
        }
        const weekly = {};
        for (const wk of ['direct', 'supervision', 'parentTraining', 'casePlanning']) {
            const v = parseFloat(row[`weekly${wk.charAt(0).toUpperCase()}${wk.slice(1)}`]);
            if (Number.isFinite(v) && v > 0)
                weekly[wk] = v;
        }
        const auth = {
            id: row.id || uuidv4(),
            clientId: String(row.clientId),
            label: row.label || undefined,
            startDate: normalizeDateString(row.startDate),
            endDate: normalizeDateString(row.endDate),
            buckets,
        };
        if (Object.keys(weekly).length > 0)
            auth.weekly = weekly;
        if (row.reportFinalDue)
            auth.reportFinalDue = normalizeDateString(row.reportFinalDue);
        if (row.reportDraftDue)
            auth.reportDraftDue = normalizeDateString(row.reportDraftDue);
        return auth;
    });
}
function parseManualUsage(workbook) {
    const sheet = workbook.Sheets['ManualUsage'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data
        .filter(row => row && row.clientId && row.bucket && row.date)
        .map((row) => ({
        id: row.id || uuidv4(),
        clientId: String(row.clientId),
        bucket: row.bucket,
        hours: parseFloat(row.hours) || 0,
        date: normalizeDateString(row.date),
        note: row.note || undefined,
    }));
}
function parseBlackouts(workbook) {
    const sheet = workbook.Sheets['Blackouts'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data
        .filter(row => row && row.entityId && row.date)
        .map((row) => ({
        id: row.id || uuidv4(),
        entityType: row.entityType === 'client' ? 'client' : 'technician',
        entityId: String(row.entityId),
        entityName: row.entityName || undefined,
        // Excel may parse a date cell into a number/Date; normalize to YYYY-MM-DD.
        date: normalizeDateString(row.date),
        reason: row.reason || undefined,
        createdAt: row.createdAt || undefined,
    }));
}
// Accept an ISO string, a YYYY-MM-DD string, or an Excel-parsed Date and
// return a YYYY-MM-DD local-day string.
function normalizeDateString(raw) {
    if (raw instanceof Date) {
        const y = raw.getFullYear();
        const m = String(raw.getMonth() + 1).padStart(2, '0');
        const d = String(raw.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(raw).trim();
    // Already YYYY-MM-DD (optionally with a time component) — take the date part.
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : s;
}
function parseEmbeddedConfig(workbook) {
    const sheet = workbook.Sheets['_Config'];
    if (!sheet)
        return undefined;
    const data = XLSX.utils.sheet_to_json(sheet);
    const row = data[0];
    return row?.encryptedBlob;
}
function parseClients(workbook) {
    const sheet = workbook.Sheets['Clients'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data.map((row) => {
        const ptMaxRaw = row.parentTrainingMaxHours;
        const ptMax = ptMaxRaw === undefined || ptMaxRaw === '' || ptMaxRaw === null
            ? undefined
            : parseFloat(ptMaxRaw);
        const client = {
            id: row.id || uuidv4(),
            name: row.name,
            availabilityWindows: parseAvailabilityWindows(row),
            notes: row.notes,
        };
        if (ptMax !== undefined && Number.isFinite(ptMax)) {
            client.parentTrainingMaxHours = ptMax;
        }
        if (row.cadenceGoal === 'W' || row.cadenceGoal === 'EOW' || row.cadenceGoal === '3o4') {
            client.cadenceGoal = row.cadenceGoal;
        }
        if (row.isEI === 'TRUE' || row.isEI === true)
            client.isEI = true;
        if (row.eiDate)
            client.eiDate = normalizeDateString(row.eiDate);
        // Default true; only store false explicitly when the sheet says N.
        if (row.partialStaffAllowed === 'FALSE' || row.partialStaffAllowed === false)
            client.partialStaffAllowed = false;
        else if (row.partialStaffAllowed === 'TRUE' || row.partialStaffAllowed === true)
            client.partialStaffAllowed = true;
        if (row.parentAvailableOutsideSessions === 'TRUE' || row.parentAvailableOutsideSessions === true) {
            client.parentAvailableOutsideSessions = true;
        }
        if (row.anticipatedDischarge)
            client.anticipatedDischarge = String(row.anticipatedDischarge);
        return client;
    });
}
function parseTechnicians(workbook) {
    const sheet = workbook.Sheets['Technicians'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data.map((row) => ({
        id: row.id || uuidv4(),
        name: row.name,
        isRBT: row.isRBT === 'TRUE' || row.isRBT === true,
        assignments: parseAssignments(row),
        availability: parseAvailabilityWindows(row),
        notes: row.notes,
    }));
}
function parseSettings(workbook) {
    const sheet = workbook.Sheets['Settings'];
    const defaultSettings = {
        supervisionDirectHoursPercent: 5,
        supervisionRBTHoursPercent: 5,
        parentTraining: {
            minimumHours: 1.5,
            targetMinHours: 2,
            targetMaxHours: 4,
            periodUnit: 'month',
        },
    };
    if (!sheet)
        return defaultSettings;
    const data = XLSX.utils.sheet_to_json(sheet);
    const row = (data && data[0]) || {};
    const periodUnit = row.parentTrainingPeriodUnit || 'month';
    const minimumHours = parseFloat(row.parentTrainingMinimum) || 1.5;
    const targetMinHours = parseFloat(row.parentTrainingTargetMin) || 2;
    const targetMaxHours = parseFloat(row.parentTrainingTargetMax) || 4;
    let clinicianAvailability = undefined;
    const clinicianRaw = row.clinicianAvailability;
    if (typeof clinicianRaw === 'string' && clinicianRaw.trim()) {
        try {
            const parsed = JSON.parse(clinicianRaw);
            if (parsed && typeof parsed === 'object')
                clinicianAvailability = parsed;
        }
        catch (_e) { /* ignore malformed clinician availability */ }
    }
    const settings = {
        supervisionDirectHoursPercent: parseFloat(row.supervisionDirectHoursPercent) || 5,
        supervisionRBTHoursPercent: parseFloat(row.supervisionRBTHoursPercent) || 5,
        parentTraining: { minimumHours, targetMinHours, targetMaxHours, periodUnit },
        clinicianAvailability,
    };
    const techPct = parseFloat(row.supervisionTechHoursPercent);
    if (Number.isFinite(techPct))
        settings.supervisionTechHoursPercent = techPct;
    const maxPct = parseFloat(row.supervisionMaxHoursPercent);
    if (Number.isFinite(maxPct))
        settings.supervisionMaxHoursPercent = maxPct;
    const minContacts = parseFloat(row.rbtMinContactsPerMonth);
    if (Number.isFinite(minContacts))
        settings.rbtMinContactsPerMonth = minContacts;
    for (const [col, key] of [
        ['supervisionFloorPercent', 'supervisionFloorPercent'],
        ['supervisionPreferredMinPercent', 'supervisionPreferredMinPercent'],
        ['supervisionPreferredMaxPercent', 'supervisionPreferredMaxPercent'],
        ['reportLeadWeeksBackOffice', 'reportLeadWeeksBackOffice'],
        ['reportLeadWeeksClinicalDirector', 'reportLeadWeeksClinicalDirector'],
    ]) {
        const v = parseFloat(row[col]);
        if (Number.isFinite(v))
            settings[key] = v;
    }
    // JSON-packed compound settings (utilization targets, cancellation notice).
    for (const [col, key] of [['utilization', 'utilization'], ['cancellationNotice', 'cancellationNotice']]) {
        const raw = row[col];
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object')
                    settings[key] = parsed;
            }
            catch (_e) { /* ignore malformed */ }
        }
    }
    return settings;
}
function parseAppointments(workbook) {
    const sheet = workbook.Sheets['Appointments'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data.map((row) => {
        const appt = {
            id: row.id || uuidv4(),
            title: row.title,
            description: row.description,
            technician: row.technician,
            client: row.client,
            startTime: row.startTime,
            endTime: row.endTime,
            isFixed: row.isFixed === 'TRUE' || row.isFixed === true,
            isBillable: row.isBillable === 'TRUE' || row.isBillable === true,
            type: row.type || 'other',
            isRecurring: row.isRecurring === 'TRUE' || row.isRecurring === true,
            recurringPattern: row.recurringPattern,
            seriesId: row.seriesId || undefined,
            isMakeUp: row.isMakeUp === 'TRUE' || row.isMakeUp === true || undefined,
            makeupForId: row.makeupForId || undefined,
        };
        if (row.status === 'completed' || row.status === 'canceled') {
            appt.status = row.status;
        }
        if (row.cancellationSource && row.cancellationReason) {
            appt.cancellation = {
                source: row.cancellationSource,
                reason: row.cancellationReason,
                unplanned: row.cancellationUnplanned === 'TRUE' || row.cancellationUnplanned === true,
                noticeMet: row.cancellationNoticeMet === 'TRUE' || row.cancellationNoticeMet === true
                    ? true
                    : row.cancellationNoticeMet === 'FALSE' || row.cancellationNoticeMet === false
                        ? false
                        : undefined,
                canceledAt: row.cancellationAt || undefined,
                notes: row.cancellationNotes || undefined,
            };
        }
        return appt;
    });
}
function parseAvailabilityWindows(row) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const availability = {};
    days.forEach(day => {
        // Multi-window format: JSON-encoded array in `${day}Windows`
        const windowsRaw = row[`${day}Windows`];
        if (typeof windowsRaw === 'string' && windowsRaw.trim()) {
            try {
                const parsed = JSON.parse(windowsRaw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    availability[day] = parsed.filter(w => w && w.start && w.end);
                    return;
                }
            }
            catch (_e) { /* fall through to legacy */ }
        }
        // Legacy single-window format: `${day}Start` / `${day}End`
        const start = row[`${day}Start`];
        const end = row[`${day}End`];
        if (start && end) {
            availability[day] = [{ start, end }];
        }
    });
    return availability;
}
function parseAssignments(row) {
    const assignments = [];
    for (let i = 1; i <= 10; i++) {
        const clientKey = `client${i}`;
        const hoursKey = `hours${i}`;
        if (row[clientKey]) {
            assignments.push({
                clientId: row[clientKey],
                hoursPerWeek: parseFloat(row[hoursKey]) || 0,
                billable: true,
            });
        }
    }
    return assignments;
}
export function generateExcelFile(data, embeddedConfig) {
    const workbook = XLSX.utils.book_new();
    // _Config sheet (optional) - holds encrypted API key + model
    if (embeddedConfig) {
        const configData = [{ encryptedBlob: embeddedConfig }];
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(configData), '_Config');
    }
    // Clients sheet
    const clientsData = data.clients.map(c => ({
        id: c.id,
        name: c.name,
        parentTrainingMaxHours: c.parentTrainingMaxHours ?? '',
        cadenceGoal: c.cadenceGoal ?? '',
        isEI: c.isEI ? 'TRUE' : '',
        eiDate: c.eiDate ?? '',
        partialStaffAllowed: c.partialStaffAllowed === false ? 'FALSE' : c.partialStaffAllowed === true ? 'TRUE' : '',
        parentAvailableOutsideSessions: c.parentAvailableOutsideSessions ? 'TRUE' : '',
        anticipatedDischarge: c.anticipatedDischarge ?? '',
        ...flattenAvailability(c.availabilityWindows),
        notes: c.notes,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clientsData), 'Clients');
    // Technicians sheet
    const techniciansData = data.technicians.map(t => ({
        id: t.id,
        name: t.name,
        isRBT: t.isRBT ? 'TRUE' : 'FALSE',
        ...flattenAvailability(t.availability),
        ...flattenAssignments(t.assignments),
        notes: t.notes,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(techniciansData), 'Technicians');
    // Settings sheet
    const settingsData = [{
            supervisionDirectHoursPercent: data.settings.supervisionDirectHoursPercent,
            supervisionRBTHoursPercent: data.settings.supervisionRBTHoursPercent,
            parentTrainingMinimum: data.settings.parentTraining.minimumHours,
            parentTrainingTargetMin: data.settings.parentTraining.targetMinHours,
            parentTrainingTargetMax: data.settings.parentTraining.targetMaxHours,
            parentTrainingPeriodUnit: data.settings.parentTraining.periodUnit,
            clinicianAvailability: data.settings.clinicianAvailability
                ? JSON.stringify(data.settings.clinicianAvailability)
                : '',
            supervisionTechHoursPercent: data.settings.supervisionTechHoursPercent ?? '',
            supervisionMaxHoursPercent: data.settings.supervisionMaxHoursPercent ?? '',
            supervisionFloorPercent: data.settings.supervisionFloorPercent ?? '',
            supervisionPreferredMinPercent: data.settings.supervisionPreferredMinPercent ?? '',
            supervisionPreferredMaxPercent: data.settings.supervisionPreferredMaxPercent ?? '',
            reportLeadWeeksBackOffice: data.settings.reportLeadWeeksBackOffice ?? '',
            reportLeadWeeksClinicalDirector: data.settings.reportLeadWeeksClinicalDirector ?? '',
            rbtMinContactsPerMonth: data.settings.rbtMinContactsPerMonth ?? '',
            utilization: data.settings.utilization ? JSON.stringify(data.settings.utilization) : '',
            cancellationNotice: data.settings.cancellationNotice ? JSON.stringify(data.settings.cancellationNotice) : '',
        }];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(settingsData), 'Settings');
    // Appointments sheet
    const appointmentsData = data.appointments.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        technician: a.technician,
        client: a.client,
        startTime: a.startTime,
        endTime: a.endTime,
        isFixed: a.isFixed ? 'TRUE' : 'FALSE',
        isBillable: a.isBillable ? 'TRUE' : 'FALSE',
        type: a.type,
        isRecurring: a.isRecurring ? 'TRUE' : 'FALSE',
        recurringPattern: a.recurringPattern,
        seriesId: a.seriesId || '',
        isMakeUp: a.isMakeUp ? 'TRUE' : '',
        makeupForId: a.makeupForId || '',
        status: a.status || 'scheduled',
        cancellationSource: a.cancellation?.source || '',
        cancellationReason: a.cancellation?.reason || '',
        cancellationUnplanned: a.cancellation ? (a.cancellation.unplanned ? 'TRUE' : 'FALSE') : '',
        cancellationNoticeMet: a.cancellation?.noticeMet === undefined
            ? ''
            : a.cancellation.noticeMet ? 'TRUE' : 'FALSE',
        cancellationAt: a.cancellation?.canceledAt || '',
        cancellationNotes: a.cancellation?.notes || '',
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(appointmentsData), 'Appointments');
    // Blackouts sheet (single-day "away" markers). Always emitted so a
    // round-trip preserves them; empty when there are none.
    const blackoutsData = (data.blackouts || []).map(b => ({
        id: b.id,
        entityType: b.entityType,
        entityId: b.entityId,
        entityName: b.entityName || '',
        date: b.date,
        reason: b.reason || '',
        createdAt: b.createdAt || '',
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(blackoutsData), 'Blackouts');
    // Authorizations sheet — bucket hours as columns keyed by AuthBucketKey.
    const authData = (data.authorizations || []).map(a => {
        const row = {
            id: a.id, clientId: a.clientId, label: a.label || '',
            startDate: a.startDate, endDate: a.endDate,
        };
        for (const { key } of AUTH_BUCKETS)
            row[key] = a.buckets[key] ?? '';
        row.weeklyDirect = a.weekly?.direct ?? '';
        row.weeklySupervision = a.weekly?.supervision ?? '';
        row.weeklyParentTraining = a.weekly?.parentTraining ?? '';
        row.weeklyCasePlanning = a.weekly?.casePlanning ?? '';
        row.reportFinalDue = a.reportFinalDue ?? '';
        row.reportDraftDue = a.reportDraftDue ?? '';
        return row;
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(authData), 'Authorizations');
    const usageData = (data.manualUsage || []).map(u => ({
        id: u.id, clientId: u.clientId, bucket: u.bucket,
        hours: u.hours, date: u.date, note: u.note || '',
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(usageData), 'ManualUsage');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}
function flattenAvailability(availability) {
    const result = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    days.forEach(day => {
        const windows = availability[day];
        if (windows && windows.length > 0) {
            // Always write the first window in legacy columns for human readability,
            // and write the full array in `${day}Windows` for round-tripping multi-window data.
            result[`${day}Start`] = windows[0].start;
            result[`${day}End`] = windows[0].end;
            result[`${day}Windows`] = JSON.stringify(windows);
        }
    });
    return result;
}
function flattenAssignments(assignments) {
    const result = {};
    assignments.forEach((assignment, index) => {
        result[`client${index + 1}`] = assignment.clientId;
        result[`hours${index + 1}`] = assignment.hoursPerWeek;
    });
    return result;
}
//# sourceMappingURL=excelHandler.js.map