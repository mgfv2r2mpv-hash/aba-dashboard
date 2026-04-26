import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
        notes: 'Senior technician, can provide supervision',
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
        notes: 'New RBT, 6 months experience',
    },
    {
        id: 'T003',
        name: 'Emma Assistant',
        isRBT: 'FALSE',
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
        client1: 'C001',
        hours1: 8,
        notes: 'RBT exam scheduled for next month',
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
        billableHoursPerCycle: 80,
        billableCycleWeeks: 4,
    },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(settingsData), 'Settings');
// Appointments sheet
const appointmentsData = [
    {
        id: 'APT001',
        title: 'Client A - Sarah (Mon)',
        description: 'Direct service with Client A',
        technician: 'Sarah Tech',
        client: 'Client A',
        startTime: '2025-05-05T09:00:00',
        endTime: '2025-05-05T12:00:00',
        isFixed: 'FALSE',
        isBillable: 'TRUE',
        type: 'client-session',
        isRecurring: 'TRUE',
        recurringPattern: 'weekly',
    },
    {
        id: 'APT002',
        title: 'Supervision - Sarah & Mike',
        description: 'Weekly supervision for RBT staff',
        technician: 'Sarah Tech',
        client: '',
        startTime: '2025-05-06T14:00:00',
        endTime: '2025-05-06T15:00:00',
        isFixed: 'FALSE',
        isBillable: 'FALSE',
        type: 'supervision',
        isRecurring: 'TRUE',
        recurringPattern: 'weekly',
    },
    {
        id: 'APT003',
        title: 'Parent Training - Client A',
        description: 'Monthly parent training session',
        technician: 'Sarah Tech',
        client: 'Client A',
        startTime: '2025-05-09T16:00:00',
        endTime: '2025-05-09T17:30:00',
        isFixed: 'TRUE',
        isBillable: 'FALSE',
        type: 'parent-training',
        isRecurring: 'FALSE',
        recurringPattern: '',
    },
    {
        id: 'APT004',
        title: 'Client B - Mike (Tue)',
        description: 'Direct service with Client B',
        technician: 'Mike Tech',
        client: 'Client B',
        startTime: '2025-05-06T13:00:00',
        endTime: '2025-05-06T15:00:00',
        isFixed: 'FALSE',
        isBillable: 'TRUE',
        type: 'client-session',
        isRecurring: 'TRUE',
        recurringPattern: 'weekly',
    },
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(appointmentsData), 'Appointments');
const samplePath = path.join(__dirname, '../sample_schedule.xlsx');
XLSX.writeFile(workbook, samplePath);
console.log('Sample file created:', samplePath);
//# sourceMappingURL=createSampleData.js.map