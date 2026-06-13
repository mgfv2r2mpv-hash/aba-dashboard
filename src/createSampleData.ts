// Regenerate the bundled sample workbook (v2 normalized format) from the
// committed ScheduleData fixture:
//   npx tsx src/createSampleData.ts
//
// The fixture (sampleSchedule.json) is the demo roster, produced once by
// migrating the prior sample via scripts/migrate-legacy-xlsx.ts. Editing the
// roster = edit the JSON, then re-run this. Vite serves public-assets/ as its
// publicDir, so the served sample lives there.
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateExcelFile } from './excelHandler';
import { ScheduleData } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sample = JSON.parse(readFileSync(path.join(__dirname, 'sampleSchedule.json'), 'utf8')) as ScheduleData;
const buffer = generateExcelFile(sample);
const outPath = path.join(__dirname, '../public-assets/sample_schedule.xlsx');
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
