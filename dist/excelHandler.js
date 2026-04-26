import XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
export function parseExcelFile(filePath) {
    const workbook = XLSX.readFile(filePath);
    const clients = parseClients(workbook);
    const technicians = parseTechnicians(workbook);
    const settings = parseSettings(workbook);
    const appointments = parseAppointments(workbook);
    return {
        id: uuidv4(),
        version: 1,
        clients,
        technicians,
        settings,
        appointments,
        lastModified: new Date().toISOString(),
    };
}
function parseClients(workbook) {
    const sheet = workbook.Sheets['Clients'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data.map((row) => ({
        id: row.id || uuidv4(),
        name: row.name,
        availabilityWindows: parseAvailabilityWindows(row),
        notes: row.notes,
    }));
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
    if (!sheet) {
        return {
            supervisionDirectHoursPercent: 5,
            supervisionRBTHoursPercent: 5,
            parentTrainingHoursPerMonth: { minimum: 1.5, target: { min: 2, max: 4 } },
        };
    }
    const data = XLSX.utils.sheet_to_json(sheet);
    const row = (data && data[0]) || {};
    return {
        supervisionDirectHoursPercent: parseFloat(row.supervisionDirectHoursPercent) || 5,
        supervisionRBTHoursPercent: parseFloat(row.supervisionRBTHoursPercent) || 5,
        parentTrainingHoursPerMonth: {
            minimum: parseFloat(row.parentTrainingMinimum) || 1.5,
            target: {
                min: parseFloat(row.parentTrainingTargetMin) || 2,
                max: parseFloat(row.parentTrainingTargetMax) || 4,
            },
        },
        billableRequirements: row.billableHoursPerCycle ? {
            hoursPerCycle: parseFloat(row.billableHoursPerCycle),
            cycleWeeks: parseFloat(row.billableCycleWeeks) || 4,
        } : undefined,
    };
}
function parseAppointments(workbook) {
    const sheet = workbook.Sheets['Appointments'];
    if (!sheet)
        return [];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data.map((row) => ({
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
    }));
}
function parseAvailabilityWindows(row) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const availability = {};
    days.forEach(day => {
        const key = `${day}Start`;
        const start = row[key];
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
export function generateExcelFile(data) {
    const workbook = XLSX.utils.book_new();
    // Clients sheet
    const clientsData = data.clients.map(c => ({
        id: c.id,
        name: c.name,
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
            parentTrainingMinimum: data.settings.parentTrainingHoursPerMonth.minimum,
            parentTrainingTargetMin: data.settings.parentTrainingHoursPerMonth.target.min,
            parentTrainingTargetMax: data.settings.parentTrainingHoursPerMonth.target.max,
            billableHoursPerCycle: data.settings.billableRequirements?.hoursPerCycle,
            billableCycleWeeks: data.settings.billableRequirements?.cycleWeeks,
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
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(appointmentsData), 'Appointments');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}
function flattenAvailability(availability) {
    const result = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    days.forEach(day => {
        if (availability[day] && availability[day].length > 0) {
            result[`${day}Start`] = availability[day][0].start;
            result[`${day}End`] = availability[day][0].end;
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