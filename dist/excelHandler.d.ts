import * as XLSX from 'xlsx';
import { ScheduleData } from './types';
export interface ParsedSchedule {
    data: ScheduleData;
    embeddedConfig?: string;
}
export declare function parseExcelFile(filePath: string): ParsedSchedule;
export declare function parseWorkbook(workbook: XLSX.WorkBook): ParsedSchedule;
export declare function generateExcelFile(data: ScheduleData, embeddedConfig?: string): Buffer;
//# sourceMappingURL=excelHandler.d.ts.map