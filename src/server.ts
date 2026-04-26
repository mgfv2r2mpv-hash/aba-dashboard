import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { ScheduleData, Appointment, ScheduleSolution } from './types';
import { parseExcelFile, generateExcelFile } from './excelHandler';
import { ConstraintValidator } from './constraintValidator';
import { ClaudeScheduler, ClaudeModel } from './claudeScheduler';
import { ExcelEncryption } from './encryption';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve built frontend from dist-client if it exists
app.use(express.static(path.join(__dirname, '../dist-client')));

// In-memory storage for current schedule data and encryption
// NOTE: API keys are NEVER stored server-side. They live only in the client browser
// and travel via X-Claude-Api-Key header for individual requests.
let currentScheduleData: ScheduleData | null = null;
let encryptionPassword: string = process.env.EXCEL_PASSWORD || ExcelEncryption.generatePassword();
let lastEmbeddedConfig: string | undefined; // Encrypted blob from uploaded Excel (returned to client, not used here)

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Upload Excel file (plain or encrypted)
app.post('/api/upload', express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'], limit: '50mb' }), (req: Request, res: Response) => {
  try {
    let buffer = req.body as Buffer;
    const tempPath = path.join(__dirname, '../temp_upload.xlsx');

    // Try to decrypt if it looks like an encrypted file
    try {
      buffer = ExcelEncryption.decrypt(buffer, encryptionPassword);
    } catch (_e) {
      // Not encrypted, use as-is
    }

    fs.writeFileSync(tempPath, buffer);

    const parsed = parseExcelFile(tempPath);
    currentScheduleData = parsed.data;
    lastEmbeddedConfig = parsed.embeddedConfig;

    // Validate immediately
    const validator = new ConstraintValidator(currentScheduleData);
    const conflicts = validator.validateSchedule();

    fs.unlinkSync(tempPath);

    res.json({
      success: true,
      data: currentScheduleData,
      conflicts,
      embeddedConfig: parsed.embeddedConfig, // Encrypted blob - client decrypts with user-supplied password
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get current schedule
app.get('/api/schedule', (req: Request, res: Response) => {
  if (!currentScheduleData) {
    return res.status(400).json({ error: 'No schedule loaded' });
  }
  res.json(currentScheduleData);
});

// Update appointment
// API key and model are passed via request headers (X-Claude-Api-Key, X-Claude-Model)
// They are NEVER stored server-side - used only for the duration of the request
app.post('/api/appointment/:id', express.json(), async (req: Request, res: Response) => {
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

    Object.assign(appointment, updates);

    // Validate constraints
    const validator = new ConstraintValidator(currentScheduleData);
    const conflicts = validator.validateSchedule();

    // Get API key and model from headers (per-request only, never stored)
    const apiKey = req.headers['x-claude-api-key'] as string | undefined;
    const model = req.headers['x-claude-model'] as ClaudeModel | undefined;

    // If conflicts exist and user has provided API key, generate solutions
    let solutions: ScheduleSolution[] = [];
    let claudeError: string | undefined;
    if (conflicts.length > 0 && apiKey) {
      try {
        const scheduler = new ClaudeScheduler(apiKey, currentScheduleData, model);
        const conflictMessages = conflicts.map(c => c.message);
        solutions = await scheduler.generateSolutions(appointment, conflictMessages);
      } catch (err: any) {
        console.error('Claude API error:', err.message);
        claudeError = err.message;
      }
    }

    res.json({
      success: true,
      appointment,
      conflicts,
      solutions,
      claudeError,
      hasApiKey: !!apiKey,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Apply solution
app.post('/api/apply-solution', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }

    const { solutionId, changes } = req.body;

    // Apply changes to appointments
    changes.forEach((change: any) => {
      const appointment = currentScheduleData!.appointments.find(a => a.id === change.appointmentId);
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
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Download schedule as encrypted Excel
// Optional: pass ?embedConfig=<base64-encrypted-blob> to embed user's API key + model
// in the file. The blob is encrypted client-side; the server never sees plaintext keys.
app.post('/api/download', express.json(), (req: Request, res: Response) => {
  if (!currentScheduleData) {
    return res.status(400).json({ error: 'No schedule loaded' });
  }

  try {
    const { embeddedConfig } = req.body as { embeddedConfig?: string };
    const buffer = generateExcelFile(currentScheduleData, embeddedConfig);
    const encrypted = ExcelEncryption.encrypt(buffer, encryptionPassword);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename=schedule.enc.xlsx');
    res.send(encrypted);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get/set encryption password
app.get('/api/encryption-password', (req: Request, res: Response) => {
  res.json({
    password: encryptionPassword,
    hint: 'Store this password securely. You will need it to decrypt downloaded files.',
  });
});

app.post('/api/encryption-password', express.json(), (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  encryptionPassword = password;
  res.json({ success: true, message: 'Encryption password updated' });
});

// Admin: Update technician
app.post('/api/admin/technician/:id', express.json(), (req: Request, res: Response) => {
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
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Admin: Create technician
app.post('/api/admin/technicians', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }
    const technician = req.body;
    if (!technician.id || !technician.name) {
      return res.status(400).json({ error: 'Technician must have id and name' });
    }
    if (currentScheduleData.technicians.some(t => t.id === technician.id)) {
      return res.status(409).json({ error: 'Technician with that id already exists' });
    }
    currentScheduleData.technicians.push(technician);
    res.json({ success: true, technician });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Delete technician
app.delete('/api/admin/technician/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = currentScheduleData.technicians.length;
  currentScheduleData.technicians = currentScheduleData.technicians.filter(t => t.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.technicians.length });
});

// Admin: Update client
app.post('/api/admin/client/:id', express.json(), (req: Request, res: Response) => {
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
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Admin: Create client
app.post('/api/admin/clients', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }
    const client = req.body;
    if (!client.id || !client.name) {
      return res.status(400).json({ error: 'Client must have id and name' });
    }
    if (currentScheduleData.clients.some(c => c.id === client.id)) {
      return res.status(409).json({ error: 'Client with that id already exists' });
    }
    currentScheduleData.clients.push(client);
    res.json({ success: true, client });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Delete client
app.delete('/api/admin/client/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = currentScheduleData.clients.length;
  currentScheduleData.clients = currentScheduleData.clients.filter(c => c.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.clients.length });
});

// Admin: Delete appointment
app.delete('/api/admin/appointment/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = currentScheduleData.appointments.length;
  currentScheduleData.appointments = currentScheduleData.appointments.filter(a => a.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.appointments.length });
});

// Admin: Create/update appointment
app.post('/api/admin/appointment', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }

    const appointmentData = req.body;
    let appointment = currentScheduleData.appointments.find(a => a.id === appointmentData.id);

    if (appointment) {
      Object.assign(appointment, appointmentData);
    } else {
      currentScheduleData.appointments.push(appointmentData);
      appointment = appointmentData;
    }

    res.json({
      success: true,
      appointment,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`ABA Schedule Assistant API running on port ${PORT}`);
});
