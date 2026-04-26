import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { parseExcelFile, generateExcelFile } from './excelHandler';
import { ConstraintValidator } from './constraintValidator';
import { ClaudeScheduler } from './claudeScheduler';
import { ExcelEncryption } from './encryption';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// In-memory storage for current schedule data and encryption
let currentScheduleData = null;
let encryptionPassword = process.env.EXCEL_PASSWORD || ExcelEncryption.generatePassword();
// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});
// Upload Excel file (plain or encrypted)
app.post('/api/upload', express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'], limit: '50mb' }), (req, res) => {
    try {
        let buffer = req.body;
        const tempPath = path.join(__dirname, '../temp_upload.xlsx');
        // Try to decrypt if it looks like an encrypted file
        try {
            buffer = ExcelEncryption.decrypt(buffer, encryptionPassword);
        }
        catch (_e) {
            // Not encrypted, use as-is
        }
        fs.writeFileSync(tempPath, buffer);
        currentScheduleData = parseExcelFile(tempPath);
        // Validate immediately
        const validator = new ConstraintValidator(currentScheduleData);
        const conflicts = validator.validateSchedule();
        fs.unlinkSync(tempPath);
        res.json({
            success: true,
            data: currentScheduleData,
            conflicts,
        });
    }
    catch (error) {
        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
});
// Get current schedule
app.get('/api/schedule', (req, res) => {
    if (!currentScheduleData) {
        return res.status(400).json({ error: 'No schedule loaded' });
    }
    res.json(currentScheduleData);
});
// Update appointment
app.post('/api/appointment/:id', express.json(), async (req, res) => {
    try {
        if (!currentScheduleData) {
            return res.status(400).json({ error: 'No schedule loaded' });
        }
        const appointmentId = req.params.id;
        const updates = req.body;
        // Find and update appointment
        const appointment = currentScheduleData.appointments.find(a => a.id === appointmentId);
        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        const oldAppointment = { ...appointment };
        Object.assign(appointment, updates);
        // Validate constraints
        const validator = new ConstraintValidator(currentScheduleData);
        const conflicts = validator.validateSchedule();
        // If conflicts exist, generate solutions using Claude
        let solutions = [];
        if (conflicts.length > 0 && process.env.CLAUDE_API_KEY) {
            try {
                const scheduler = new ClaudeScheduler(process.env.CLAUDE_API_KEY, currentScheduleData);
                const conflictMessages = conflicts.map(c => c.message);
                solutions = await scheduler.generateSolutions(appointment, conflictMessages);
            }
            catch (claudeError) {
                console.error('Claude API error:', claudeError.message);
                // Continue without Claude solutions
            }
        }
        res.json({
            success: true,
            appointment,
            conflicts,
            solutions,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
// Apply solution
app.post('/api/apply-solution', express.json(), (req, res) => {
    try {
        if (!currentScheduleData) {
            return res.status(400).json({ error: 'No schedule loaded' });
        }
        const { solutionId, changes } = req.body;
        // Apply changes to appointments
        changes.forEach((change) => {
            const appointment = currentScheduleData.appointments.find(a => a.id === change.appointmentId);
            if (appointment) {
                appointment.startTime = change.newTime.start;
                appointment.endTime = change.newTime.end;
            }
        });
        // Revalidate
        const validator = new ConstraintValidator(currentScheduleData);
        const conflicts = validator.validateSchedule();
        res.json({
            success: true,
            data: currentScheduleData,
            conflicts,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
// Download schedule as encrypted Excel
app.get('/api/download', (req, res) => {
    if (!currentScheduleData) {
        return res.status(400).json({ error: 'No schedule loaded' });
    }
    try {
        const buffer = generateExcelFile(currentScheduleData);
        const encrypted = ExcelEncryption.encrypt(buffer, encryptionPassword);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename=schedule.enc.xlsx');
        res.send(encrypted);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
// Get/set encryption password
app.get('/api/encryption-password', (req, res) => {
    res.json({
        password: encryptionPassword,
        hint: 'Store this password securely. You will need it to decrypt downloaded files.',
    });
});
app.post('/api/encryption-password', express.json(), (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    encryptionPassword = password;
    res.json({ success: true, message: 'Encryption password updated' });
});
// Admin: Update technician
app.post('/api/admin/technician/:id', express.json(), (req, res) => {
    try {
        if (!currentScheduleData) {
            return res.status(400).json({ error: 'No schedule loaded' });
        }
        const techId = req.params.id;
        const updates = req.body;
        const technician = currentScheduleData.technicians.find(t => t.id === techId);
        if (!technician) {
            return res.status(404).json({ error: 'Technician not found' });
        }
        Object.assign(technician, updates);
        res.json({
            success: true,
            technician,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
// Admin: Update client
app.post('/api/admin/client/:id', express.json(), (req, res) => {
    try {
        if (!currentScheduleData) {
            return res.status(400).json({ error: 'No schedule loaded' });
        }
        const clientId = req.params.id;
        const updates = req.body;
        const client = currentScheduleData.clients.find(c => c.id === clientId);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        Object.assign(client, updates);
        res.json({
            success: true,
            client,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
// Admin: Create/update appointment
app.post('/api/admin/appointment', express.json(), (req, res) => {
    try {
        if (!currentScheduleData) {
            return res.status(400).json({ error: 'No schedule loaded' });
        }
        const appointmentData = req.body;
        let appointment = currentScheduleData.appointments.find(a => a.id === appointmentData.id);
        if (appointment) {
            Object.assign(appointment, appointmentData);
        }
        else {
            currentScheduleData.appointments.push(appointmentData);
            appointment = appointmentData;
        }
        res.json({
            success: true,
            appointment,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
app.listen(PORT, () => {
    console.log(`ABA Schedule Assistant API running on port ${PORT}`);
});
//# sourceMappingURL=server.js.map