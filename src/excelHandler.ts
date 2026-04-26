import XLSX from 'xlsx';
import { ScheduleData, Appointment, Technician, Client, CompanySettings, DayOfWeek } from './types';
import { v4 as uuidv4 } from 'uuid';

export interface ParsedSchedule {
  data: ScheduleData;
  embeddedConfig?: string; // Encrypted blob containing API key + model preferences
}

export function parseExcelFile(filePath: string): ParsedSchedule {
  const workbook = XLSX.readFile(filePath);

  const clients = parseClients(workbook);
  const technicians = parseTechnicians(workbook);
  const settings = parseSettings(workbook);
  const appointments = parseAppointments(workbook);
  const embeddedConfig = parseEmbeddedConfig(workbook);

  return {
    data: {
      id: uuidv4(),
      version: 1,
      clients,
      technicians,
      settings,
      appointments,
      lastModified: new Date().toISOString(),
    },
    embeddedConfig,
  };
}

function parseEmbeddedConfig(workbook: XLSX.WorkBook): string | undefined {
  const sheet = workbook.Sheets['_Config'];
  if (!sheet) return undefined;

  const data = XLSX.utils.sheet_to_json(sheet) as any[];
  const row = data[0];
  return row?.encryptedBlob;
}

function parseClients(workbook: XLSX.WorkBook): Client[] {
  const sheet = workbook.Sheets['Clients'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
  return data.map((row: any) => ({
    id: row.id || uuidv4(),
    name: row.name,
    availabilityWindows: parseAvailabilityWindows(row),
    notes: row.notes,
  }));
}

function parseTechnicians(workbook: XLSX.WorkBook): Technician[] {
  const sheet = workbook.Sheets['Technicians'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
  return data.map((row: any) => ({
    id: row.id || uuidv4(),
    name: row.name,
    isRBT: row.isRBT === 'TRUE' || row.isRBT === true,
    assignments: parseAssignments(row),
    availability: parseAvailabilityWindows(row),
    notes: row.notes,
  }));
}

function parseSettings(workbook: XLSX.WorkBook): CompanySettings {
  const sheet = workbook.Sheets['Settings'];
  const defaultSettings: CompanySettings = {
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: 5,
    parentTraining: {
      minimumHours: 1.5,
      targetMinHours: 2,
      targetMaxHours: 4,
      periodUnit: 'month',
    },
  };
  if (!sheet) return defaultSettings;

  const data = XLSX.utils.sheet_to_json(sheet) as any[];
  const row = (data && data[0]) || {};

  const periodUnit = (row.parentTrainingPeriodUnit as any) || 'month';
  const minimumHours = parseFloat(row.parentTrainingMinimum) || 1.5;
  const targetMinHours = parseFloat(row.parentTrainingTargetMin) || 2;
  const targetMaxHours = parseFloat(row.parentTrainingTargetMax) || 4;

  return {
    supervisionDirectHoursPercent: parseFloat(row.supervisionDirectHoursPercent) || 5,
    supervisionRBTHoursPercent: parseFloat(row.supervisionRBTHoursPercent) || 5,
    parentTraining: { minimumHours, targetMinHours, targetMaxHours, periodUnit },
    billableRequirements: row.billableHoursPerCycle ? {
      hoursPerCycle: parseFloat(row.billableHoursPerCycle),
      cycleWeeks: parseFloat(row.billableCycleWeeks) || 4,
    } : undefined,
  };
}

function parseAppointments(workbook: XLSX.WorkBook): Appointment[] {
  const sheet = workbook.Sheets['Appointments'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
  return data.map((row: any) => ({
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

function parseAvailabilityWindows(row: any): { [key: string]: any[] } {
  const days: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const availability: { [key: string]: any[] } = {};

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
      } catch (_e) { /* fall through to legacy */ }
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

function parseAssignments(row: any) {
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

export function generateExcelFile(data: ScheduleData, embeddedConfig?: string): Buffer {
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

function flattenAvailability(availability: { [key: string]: any[] }): any {
  const result: any = {};
  const days: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

function flattenAssignments(assignments: any[]): any {
  const result: any = {};
  assignments.forEach((assignment, index) => {
    result[`client${index + 1}`] = assignment.clientId;
    result[`hours${index + 1}`] = assignment.hoursPerWeek;
  });
  return result;
}
