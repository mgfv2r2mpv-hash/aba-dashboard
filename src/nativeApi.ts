// On Capacitor native (iOS/Android) the WebView at capacitor://localhost has
// no Express server reachable, so all /api/* requests would 404. This module
// installs a custom axios adapter that resolves /api/* calls against an
// in-memory copy of the schedule, mirroring the response shapes of server.ts.
//
// Limitations vs. the Node server:
//   - /api/appointment/:id returns solutions=[] (Claude is not invoked here).
//   - /api/download returns a plain .xlsx; no AES-CBC encryption (Node-only).
//   - /api/upload is handled in app.tsx via xlsx + parseWorkbook directly.

import axios, { AxiosAdapter, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { ScheduleData } from './types';
import { ConstraintValidator } from './constraintValidator';
import { generateExcelFile } from './excelHandler';

let store: ScheduleData | null = null;

// Deep-clone in/out so the store stays isolated from React state.
// Without this, mutations like `store.technicians.push(...)` would leak
// into the React tree the caller is about to spread, causing double-adds.
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function setCurrentData(data: ScheduleData) {
  store = clone(data);
}

export function getCurrentData(): ScheduleData | null {
  return store ? clone(store) : null;
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireData(): ScheduleData {
  if (!store) throw new HttpError('No schedule loaded');
  return store;
}

function validate(data: ScheduleData) {
  return new ConstraintValidator(data).validateSchedule();
}

async function route(method: string, path: string, body: any): Promise<any> {
  const m = method.toUpperCase();

  if (m === 'GET' && path === '/api/health') {
    return { status: 'ok' };
  }

  if (m === 'GET' && path === '/api/schedule') {
    return requireData();
  }

  if (m === 'POST' && path === '/api/schedule') {
    const data = body as ScheduleData;
    if (!data || !Array.isArray(data.technicians) || !Array.isArray(data.clients) || !Array.isArray(data.appointments)) {
      throw new HttpError('Invalid schedule payload');
    }
    store = data;
    return { success: true, data, conflicts: validate(data) };
  }

  const apptIdMatch = path.match(/^\/api\/appointment\/([^/]+)$/);
  if (m === 'POST' && apptIdMatch) {
    const data = requireData();
    const appt = data.appointments.find(a => a.id === apptIdMatch[1]);
    if (!appt) throw new HttpError('Appointment not found', 404);
    Object.assign(appt, body);
    return {
      success: true,
      appointment: appt,
      conflicts: validate(data),
      solutions: [],
      claudeError: undefined,
      hasApiKey: false,
    };
  }

  if (m === 'POST' && path === '/api/apply-solution') {
    const data = requireData();
    const changes = body?.changes || [];
    changes.forEach((change: any) => {
      const a = data.appointments.find(x => x.id === change.appointmentId);
      if (a) {
        a.startTime = change.newTime.start;
        a.endTime = change.newTime.end;
      }
    });
    return { success: true, data, conflicts: validate(data) };
  }

  if (m === 'POST' && path === '/api/download') {
    const data = requireData();
    const embeddedConfig = body?.embeddedConfig as string | undefined;
    const bytes = generateExcelFile(data, embeddedConfig);
    return new Blob([bytes as any], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  const techIdMatch = path.match(/^\/api\/admin\/technician\/([^/]+)$/);
  if (techIdMatch) {
    const data = requireData();
    const id = techIdMatch[1];
    if (m === 'POST') {
      const tech = data.technicians.find(t => t.id === id);
      if (!tech) throw new HttpError('Technician not found', 404);
      Object.assign(tech, body);
      return { success: true, technician: tech };
    }
    if (m === 'DELETE') {
      const before = data.technicians.length;
      data.technicians = data.technicians.filter(t => t.id !== id);
      return { success: true, removed: before - data.technicians.length };
    }
  }

  if (m === 'POST' && path === '/api/admin/technicians') {
    const data = requireData();
    if (!body?.id || !body?.name) throw new HttpError('Technician must have id and name');
    if (data.technicians.some(t => t.id === body.id)) throw new HttpError('Technician with that id already exists', 409);
    data.technicians.push(body);
    return { success: true, technician: body };
  }

  const clientIdMatch = path.match(/^\/api\/admin\/client\/([^/]+)$/);
  if (clientIdMatch) {
    const data = requireData();
    const id = clientIdMatch[1];
    if (m === 'POST') {
      const client = data.clients.find(c => c.id === id);
      if (!client) throw new HttpError('Client not found', 404);
      Object.assign(client, body);
      return { success: true, client };
    }
    if (m === 'DELETE') {
      const before = data.clients.length;
      data.clients = data.clients.filter(c => c.id !== id);
      return { success: true, removed: before - data.clients.length };
    }
  }

  if (m === 'POST' && path === '/api/admin/clients') {
    const data = requireData();
    if (!body?.id || !body?.name) throw new HttpError('Client must have id and name');
    if (data.clients.some(c => c.id === body.id)) throw new HttpError('Client with that id already exists', 409);
    data.clients.push(body);
    return { success: true, client: body };
  }

  if (m === 'POST' && path === '/api/admin/appointment') {
    const data = requireData();
    let appt = data.appointments.find(a => a.id === body.id);
    if (appt) Object.assign(appt, body);
    else { data.appointments.push(body); appt = body; }
    return { success: true, appointment: appt };
  }

  const adminApptMatch = path.match(/^\/api\/admin\/appointment\/([^/]+)$/);
  if (m === 'DELETE' && adminApptMatch) {
    const data = requireData();
    const before = data.appointments.length;
    data.appointments = data.appointments.filter(a => a.id !== adminApptMatch[1]);
    return { success: true, removed: before - data.appointments.length };
  }

  throw new HttpError(`Native API: no handler for ${m} ${path}`, 404);
}

const nativeAdapter: AxiosAdapter = (config: InternalAxiosRequestConfig) => {
  return new Promise<AxiosResponse>((resolve, reject) => {
    (async () => {
      const url = config.url || '';
      // Strip query string and resolve to a pathname.
      const path = (url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]) || '/';

      let body = config.data;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* leave as string */ }
      }

      try {
        const data = await route(config.method || 'GET', path, body);
        // Blob responses (download) pass through as-is; JSON responses are
        // cloned so the caller can never reach back into the live store.
        const out = data instanceof Blob ? data : clone(data);
        resolve({
          data: out,
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          request: null,
        } as AxiosResponse);
      } catch (e: any) {
        const status = e instanceof HttpError ? e.status : 500;
        const err: any = new Error(e.message);
        err.config = config;
        err.response = {
          data: { error: e.message },
          status,
          statusText: status >= 500 ? 'Server Error' : 'Bad Request',
          headers: {},
          config,
        };
        reject(err);
      }
    })();
  });
};

export function installNativeAdapter() {
  axios.defaults.adapter = nativeAdapter;
}
