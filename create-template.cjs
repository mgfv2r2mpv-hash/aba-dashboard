// Generates `template.xlsx` — the starting-point file to load into the dashboard
// instead of running the wizard each time. Tweak the data below and re-run:
//   node create-template.js

const XLSX = require('xlsx');

const workbook = XLSX.utils.book_new();

// --- Clients ---------------------------------------------------------------
// Client AA: M-Th 4:30pm – 7:00pm, off Fri/Sat/Sun
const clientsData = [
  {
    id: 'AA',
    name: 'Client AA',
    MondayStart: '16:30',
    MondayEnd: '19:00',
    TuesdayStart: '16:30',
    TuesdayEnd: '19:00',
    WednesdayStart: '16:30',
    WednesdayEnd: '19:00',
    ThursdayStart: '16:30',
    ThursdayEnd: '19:00',
    notes: 'Test client',
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clientsData), 'Clients');

// --- Technicians -----------------------------------------------------------
// Maimouna (BT/RBT): M-F two windows per day — 8:45am-12:00pm and 4:30pm-7:00pm
const splitWindows = JSON.stringify([
  { start: '08:45', end: '12:00' },
  { start: '16:30', end: '19:00' },
]);

const techniciansData = [
  {
    id: 'T001',
    name: 'Maimouna',
    isRBT: 'TRUE',
    MondayWindows: splitWindows,
    TuesdayWindows: splitWindows,
    WednesdayWindows: splitWindows,
    ThursdayWindows: splitWindows,
    FridayWindows: splitWindows,
    notes: 'BT',
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(techniciansData), 'Technicians');

// --- Settings --------------------------------------------------------------
// BCBA (clinician) availability — M-F 7am-8pm, Sat 10am-3pm, off Sunday.
const clinicianAvailability = {
  Monday:    [{ start: '07:00', end: '20:00' }],
  Tuesday:   [{ start: '07:00', end: '20:00' }],
  Wednesday: [{ start: '07:00', end: '20:00' }],
  Thursday:  [{ start: '07:00', end: '20:00' }],
  Friday:    [{ start: '07:00', end: '20:00' }],
  Saturday:  [{ start: '10:00', end: '15:00' }],
};

const settingsData = [
  {
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: 5,
    parentTrainingMinimum: 1.5,
    parentTrainingTargetMin: 2,
    parentTrainingTargetMax: 4,
    parentTrainingPeriodUnit: 'month',
    clinicianAvailability: JSON.stringify(clinicianAvailability),
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(settingsData), 'Settings');

// --- Appointments (empty placeholder) --------------------------------------
const appointmentsData = [];
const apptSheet = XLSX.utils.json_to_sheet(appointmentsData, {
  header: ['id', 'title', 'description', 'technician', 'client', 'startTime', 'endTime',
           'isFixed', 'isBillable', 'type', 'isRecurring', 'recurringPattern'],
});
XLSX.utils.book_append_sheet(workbook, apptSheet, 'Appointments');

XLSX.writeFile(workbook, 'template.xlsx');
console.log('Template written: template.xlsx');
