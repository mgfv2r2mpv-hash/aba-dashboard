const XLSX = require('xlsx');

// Anchor the sample to the current week so the calendar lands on appointments
// you can actually see, no matter when the file was generated.
function isoOnDay(weekdayOffset, hour, minute = 0) {
  const now = new Date();
  const monday = new Date(now);
  // getDay(): 0=Sun..6=Sat. Shift to Monday-of-this-week.
  const shift = (now.getDay() + 6) % 7;
  monday.setDate(now.getDate() - shift);
  monday.setHours(0, 0, 0, 0);
  const d = new Date(monday);
  d.setDate(monday.getDate() + weekdayOffset);
  d.setHours(hour, minute, 0, 0);
  // YYYY-MM-DDTHH:MM:SS in local time, no timezone — matches the existing
  // Calendar filter that does `startTime.startsWith('YYYY-MM-DD')`.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

const workbook = XLSX.utils.book_new();

// Clients sheet
const clientsData = [
  {
    id: 'C001',
    name: 'Client A',
    MondayStart: '09:00',
    MondayEnd: '17:00',
    TuesdayStart: '09:00',
    TuesdayEnd: '17:00',
    WednesdayStart: '09:00',
    WednesdayEnd: '17:00',
    ThursdayStart: '09:00',
    ThursdayEnd: '17:00',
    FridayStart: '09:00',
    FridayEnd: '17:00',
    notes: 'Home-based services',
  },
  {
    id: 'C002',
    name: 'Client B',
    MondayStart: '13:00',
    MondayEnd: '18:00',
    TuesdayStart: '13:00',
    TuesdayEnd: '18:00',
    WednesdayStart: '13:00',
    WednesdayEnd: '18:00',
    ThursdayStart: '13:00',
    ThursdayEnd: '18:00',
    FridayStart: '09:00',
    FridayEnd: '17:00',
    notes: 'After school services',
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clientsData), 'Clients');

// Technicians sheet
const techniciansData = [
  {
    id: 'T001',
    name: 'Sarah Tech',
    isRBT: 'TRUE',
    MondayStart: '08:00',
    MondayEnd: '17:00',
    TuesdayStart: '08:00',
    TuesdayEnd: '17:00',
    WednesdayStart: '08:00',
    WednesdayEnd: '17:00',
    ThursdayStart: '08:00',
    ThursdayEnd: '17:00',
    FridayStart: '08:00',
    FridayEnd: '17:00',
    client1: 'C001',
    hours1: 15,
    client2: 'C002',
    hours2: 5,
    notes: 'Senior technician',
  },
  {
    id: 'T002',
    name: 'Mike Tech',
    isRBT: 'TRUE',
    MondayStart: '09:00',
    MondayEnd: '18:00',
    TuesdayStart: '09:00',
    TuesdayEnd: '18:00',
    WednesdayStart: '09:00',
    WednesdayEnd: '18:00',
    ThursdayStart: '09:00',
    ThursdayEnd: '18:00',
    FridayStart: '10:00',
    FridayEnd: '16:00',
    client1: 'C001',
    hours1: 10,
    client2: 'C002',
    hours2: 10,
    notes: 'New RBT',
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(techniciansData), 'Technicians');

// Settings sheet
const settingsData = [
  {
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: 5,
    parentTrainingMinimum: 1.5,
    parentTrainingTargetMin: 2,
    parentTrainingTargetMax: 4,
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(settingsData), 'Settings');

// Appointments sheet
const appointmentsData = [
  {
    id: 'APT001',
    title: 'Client A - Sarah (Mon)',
    description: 'Direct service',
    technician: 'Sarah Tech',
    client: 'Client A',
    startTime: isoOnDay(0, 9),  // Mon 09:00
    endTime: isoOnDay(0, 12),   // Mon 12:00
    isFixed: 'FALSE',
    isBillable: 'TRUE',
    type: 'client-session',
    isRecurring: 'TRUE',
    recurringPattern: 'weekly',
  },
  {
    id: 'APT002',
    title: 'Supervision — Client A',
    description: 'Weekly case supervision; tech being supervised is whoever is in session',
    // Supervision carries client only — no technician. The supervised tech
    // is inferred from whichever direct session(s) for this client overlap
    // the supervision window.
    technician: '',
    client: 'Client A',
    // Mon 10–11 — overlaps APT001 (Mon 9–12 client-session for Client A
    // by Sarah), so it counts toward Client A's supervision compliance.
    startTime: isoOnDay(0, 10),
    endTime: isoOnDay(0, 11),
    isFixed: 'FALSE',
    isBillable: 'FALSE',
    type: 'supervision',
    isRecurring: 'TRUE',
    recurringPattern: 'weekly',
  },
  {
    id: 'APT003',
    title: 'Parent Training',
    description: 'Monthly session',
    technician: 'Sarah Tech',
    client: 'Client A',
    startTime: isoOnDay(4, 16, 0),  // Fri 16:00
    endTime: isoOnDay(4, 17, 30),   // Fri 17:30
    isFixed: 'TRUE',
    isBillable: 'FALSE',
    type: 'parent-training',
    isRecurring: 'FALSE',
    recurringPattern: '',
  },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(appointmentsData), 'Appointments');

XLSX.writeFile(workbook, 'sample_schedule.xlsx');
console.log('Sample file created: sample_schedule.xlsx');
