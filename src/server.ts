import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ScheduleData, Appointment } from './types';
import { parseExcelFile } from './excelHandler';
import { ConstraintValidator } from './constraintValidator';
import { ExcelEncryption } from './encryption';

dotenv.config();

// ESM has no __dirname; derive it from the module URL (matches createSampleData.ts).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Replace current schedule (used by the Setup Wizard, since it builds
// schedule data client-side and never goes through the Excel upload path).
app.post('/api/schedule', express.json({ limit: '10mb' }), (req: Request, res: Response) => {
  try {
    const data = req.body as ScheduleData;
    if (!data || !Array.isArray(data.technicians) || !Array.isArray(data.clients) || !Array.isArray(data.appointments)) {
      return res.status(400).json({ error: 'Invalid schedule payload' });
    }
    currentScheduleData = data;
    const validator = new ConstraintValidator(currentScheduleData);
    const conflicts = validator.validateSchedule();
    res.json({ success: true, data: currentScheduleData, conflicts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
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

    res.json({
      success: true,
      appointment,
      conflicts,
    });
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

// Admin: Create/update authorization
app.post('/api/admin/authorization', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
    const auth = req.body;
    if (!auth.id || !auth.clientId || !auth.startDate || !auth.endDate) {
      return res.status(400).json({ error: 'Authorization must have id, clientId, startDate, endDate' });
    }
    if (!currentScheduleData.authorizations) currentScheduleData.authorizations = [];
    const existing = currentScheduleData.authorizations.find(a => a.id === auth.id);
    if (existing) Object.assign(existing, auth);
    else currentScheduleData.authorizations.push(auth);
    res.json({ success: true, authorization: existing || auth });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Delete authorization
app.delete('/api/admin/authorization/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = (currentScheduleData.authorizations || []).length;
  currentScheduleData.authorizations = (currentScheduleData.authorizations || []).filter(a => a.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.authorizations.length });
});

// Admin: Create/update manual usage entry
app.post('/api/admin/manual-usage', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
    const usage = req.body;
    if (!usage.id || !usage.clientId || !usage.bucket || !usage.date) {
      return res.status(400).json({ error: 'Manual usage must have id, clientId, bucket, date' });
    }
    if (!currentScheduleData.manualUsage) currentScheduleData.manualUsage = [];
    const existing = currentScheduleData.manualUsage.find(u => u.id === usage.id);
    if (existing) Object.assign(existing, usage);
    else currentScheduleData.manualUsage.push(usage);
    res.json({ success: true, usage: existing || usage });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Delete manual usage entry
app.delete('/api/admin/manual-usage/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = (currentScheduleData.manualUsage || []).length;
  currentScheduleData.manualUsage = (currentScheduleData.manualUsage || []).filter(u => u.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.manualUsage.length });
});

// Admin: Reorder clients or technicians
app.post('/api/admin/reorder', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }
    const { entity, order } = req.body as { entity?: string; order?: string[] };
    if (entity !== 'clients' && entity !== 'technicians') {
      return res.status(400).json({ error: 'reorder: entity must be clients or technicians' });
    }
    const orderIds: string[] = Array.isArray(order) ? order : [];
    const list = (currentScheduleData as any)[entity] as { id: string }[];
    const byId = new Map(list.map(x => [x.id, x]));
    const reordered = orderIds.map(id => byId.get(id)).filter(Boolean) as { id: string }[];
    for (const x of list) if (!orderIds.includes(x.id)) reordered.push(x);
    (currentScheduleData as any)[entity] = reordered;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Update company settings
app.post('/api/admin/settings', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }
    // Merge so wizard-only fields (clinicianAvailability, legacy mirrors) survive.
    currentScheduleData.settings = { ...currentScheduleData.settings, ...req.body };
    res.json({ success: true, settings: currentScheduleData.settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Create/update blackout (single-day "away" marker)
app.post('/api/admin/blackout', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }
    const blackout = req.body;
    if (!blackout.id || !blackout.entityId || !blackout.date) {
      return res.status(400).json({ error: 'Blackout must have id, entityId and date' });
    }
    if (!currentScheduleData.blackouts) currentScheduleData.blackouts = [];
    const existing = currentScheduleData.blackouts.find(b => b.id === blackout.id);
    if (existing) {
      Object.assign(existing, blackout);
    } else {
      currentScheduleData.blackouts.push(blackout);
    }
    res.json({ success: true, blackout: existing || blackout });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Delete blackout
app.delete('/api/admin/blackout/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = (currentScheduleData.blackouts || []).length;
  currentScheduleData.blackouts = (currentScheduleData.blackouts || []).filter(b => b.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.blackouts.length });
});

// Admin: Create/update a BCBA time-off (leave) entry
app.post('/api/admin/time-off', express.json(), (req: Request, res: Response) => {
  try {
    if (!currentScheduleData) {
      return res.status(400).json({ error: 'No schedule loaded' });
    }
    const t = req.body;
    if (!t.id || !t.date || !(Number(t.hours) > 0)) {
      return res.status(400).json({ error: 'Time off must have id, date and positive hours' });
    }
    if (!currentScheduleData.timeOff) currentScheduleData.timeOff = [];
    const existing = currentScheduleData.timeOff.find(x => x.id === t.id);
    if (existing) {
      Object.assign(existing, t);
    } else {
      currentScheduleData.timeOff.push(t);
    }
    res.json({ success: true, timeOff: existing || t });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Delete a time-off entry
app.delete('/api/admin/time-off/:id', (req: Request, res: Response) => {
  if (!currentScheduleData) return res.status(400).json({ error: 'No schedule loaded' });
  const before = (currentScheduleData.timeOff || []).length;
  currentScheduleData.timeOff = (currentScheduleData.timeOff || []).filter(t => t.id !== req.params.id);
  res.json({ success: true, removed: before - currentScheduleData.timeOff.length });
});

app.listen(PORT, () => {
  console.log(`ABA Schedule Assistant API running on port ${PORT}`);
});
