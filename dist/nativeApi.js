// On Capacitor native (iOS/Android) the WebView at capacitor://localhost has
// no Express server reachable, so all /api/* requests would 404. This module
// installs a custom axios adapter that resolves /api/* calls against an
// in-memory copy of the schedule, mirroring the response shapes of server.ts.
//
// Limitations vs. the Node server:
//   - /api/appointment/:id returns solutions=[] (Claude is not invoked here).
//   - /api/download returns a plain .xlsx; no AES-CBC encryption (Node-only).
//   - /api/upload is handled in app.tsx via xlsx + parseWorkbook directly.
import axios from 'axios';
import { ConstraintValidator } from './constraintValidator';
import { generateExcelFile } from './excelHandler';
let store = null;
// Deep-clone in/out so the store stays isolated from React state.
// Without this, mutations like `store.technicians.push(...)` would leak
// into the React tree the caller is about to spread, causing double-adds.
function clone(v) {
    return JSON.parse(JSON.stringify(v));
}
export function setCurrentData(data) {
    store = clone(data);
}
export function getCurrentData() {
    return store ? clone(store) : null;
}
class HttpError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
function requireData() {
    if (!store)
        throw new HttpError('No schedule loaded');
    return store;
}
function validate(data) {
    return new ConstraintValidator(data).validateSchedule();
}
async function route(method, path, body) {
    const m = method.toUpperCase();
    if (m === 'GET' && path === '/api/health') {
        return { status: 'ok' };
    }
    if (m === 'GET' && path === '/api/schedule') {
        return requireData();
    }
    if (m === 'POST' && path === '/api/schedule') {
        const data = body;
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
        if (!appt)
            throw new HttpError('Appointment not found', 404);
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
        changes.forEach((change) => {
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
        const embeddedConfig = body?.embeddedConfig;
        const bytes = generateExcelFile(data, embeddedConfig);
        return new Blob([bytes], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
    }
    const techIdMatch = path.match(/^\/api\/admin\/technician\/([^/]+)$/);
    if (techIdMatch) {
        const data = requireData();
        const id = techIdMatch[1];
        if (m === 'POST') {
            const tech = data.technicians.find(t => t.id === id);
            if (!tech)
                throw new HttpError('Technician not found', 404);
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
        if (!body?.id || !body?.name)
            throw new HttpError('Technician must have id and name');
        if (data.technicians.some(t => t.id === body.id))
            throw new HttpError('Technician with that id already exists', 409);
        data.technicians.push(body);
        return { success: true, technician: body };
    }
    const clientIdMatch = path.match(/^\/api\/admin\/client\/([^/]+)$/);
    if (clientIdMatch) {
        const data = requireData();
        const id = clientIdMatch[1];
        if (m === 'POST') {
            const client = data.clients.find(c => c.id === id);
            if (!client)
                throw new HttpError('Client not found', 404);
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
        if (!body?.id || !body?.name)
            throw new HttpError('Client must have id and name');
        if (data.clients.some(c => c.id === body.id))
            throw new HttpError('Client with that id already exists', 409);
        data.clients.push(body);
        return { success: true, client: body };
    }
    if (m === 'POST' && path === '/api/admin/appointment') {
        const data = requireData();
        let appt = data.appointments.find(a => a.id === body.id);
        if (appt)
            Object.assign(appt, body);
        else {
            data.appointments.push(body);
            appt = body;
        }
        return { success: true, appointment: appt };
    }
    const adminApptMatch = path.match(/^\/api\/admin\/appointment\/([^/]+)$/);
    if (m === 'DELETE' && adminApptMatch) {
        const data = requireData();
        const before = data.appointments.length;
        data.appointments = data.appointments.filter(a => a.id !== adminApptMatch[1]);
        return { success: true, removed: before - data.appointments.length };
    }
    if (m === 'POST' && path === '/api/admin/authorization') {
        const data = requireData();
        if (!body?.id || !body?.clientId || !body?.startDate || !body?.endDate) {
            throw new HttpError('Authorization must have id, clientId, startDate, endDate');
        }
        if (!data.authorizations)
            data.authorizations = [];
        const existing = data.authorizations.find(a => a.id === body.id);
        if (existing)
            Object.assign(existing, body);
        else
            data.authorizations.push(body);
        return { success: true, authorization: existing || body };
    }
    const authIdMatch = path.match(/^\/api\/admin\/authorization\/([^/]+)$/);
    if (m === 'DELETE' && authIdMatch) {
        const data = requireData();
        const before = (data.authorizations || []).length;
        data.authorizations = (data.authorizations || []).filter(a => a.id !== authIdMatch[1]);
        return { success: true, removed: before - data.authorizations.length };
    }
    if (m === 'POST' && path === '/api/admin/manual-usage') {
        const data = requireData();
        if (!body?.id || !body?.clientId || !body?.bucket || !body?.date) {
            throw new HttpError('Manual usage must have id, clientId, bucket, date');
        }
        if (!data.manualUsage)
            data.manualUsage = [];
        const existing = data.manualUsage.find(u => u.id === body.id);
        if (existing)
            Object.assign(existing, body);
        else
            data.manualUsage.push(body);
        return { success: true, usage: existing || body };
    }
    const usageIdMatch = path.match(/^\/api\/admin\/manual-usage\/([^/]+)$/);
    if (m === 'DELETE' && usageIdMatch) {
        const data = requireData();
        const before = (data.manualUsage || []).length;
        data.manualUsage = (data.manualUsage || []).filter(u => u.id !== usageIdMatch[1]);
        return { success: true, removed: before - data.manualUsage.length };
    }
    if (m === 'POST' && path === '/api/admin/reorder') {
        const data = requireData();
        const entity = body?.entity;
        if (entity !== 'clients' && entity !== 'technicians') {
            throw new HttpError('reorder: entity must be clients or technicians');
        }
        const orderIds = Array.isArray(body?.order) ? body.order : [];
        const list = data[entity];
        const byId = new Map(list.map(x => [x.id, x]));
        const reordered = orderIds.map(id => byId.get(id)).filter(Boolean);
        // Safety: append anything not named in the order list, preserving order.
        for (const x of list)
            if (!orderIds.includes(x.id))
                reordered.push(x);
        data[entity] = reordered;
        return { success: true };
    }
    if (m === 'POST' && path === '/api/admin/settings') {
        const data = requireData();
        if (!body || typeof body !== 'object')
            throw new HttpError('Invalid settings payload');
        // Merge so wizard-only fields (clinicianAvailability, legacy mirrors) survive.
        data.settings = { ...data.settings, ...body };
        return { success: true, settings: data.settings };
    }
    if (m === 'POST' && path === '/api/admin/blackout') {
        const data = requireData();
        if (!body?.id || !body?.entityId || !body?.date) {
            throw new HttpError('Blackout must have id, entityId and date');
        }
        if (!data.blackouts)
            data.blackouts = [];
        const existing = data.blackouts.find(b => b.id === body.id);
        if (existing)
            Object.assign(existing, body);
        else
            data.blackouts.push(body);
        return { success: true, blackout: existing || body };
    }
    const blackoutIdMatch = path.match(/^\/api\/admin\/blackout\/([^/]+)$/);
    if (m === 'DELETE' && blackoutIdMatch) {
        const data = requireData();
        const before = (data.blackouts || []).length;
        data.blackouts = (data.blackouts || []).filter(b => b.id !== blackoutIdMatch[1]);
        return { success: true, removed: before - data.blackouts.length };
    }
    if (m === 'POST' && path === '/api/admin/time-off') {
        const data = requireData();
        if (!body?.id || !body?.date || !(Number(body?.hours) > 0)) {
            throw new HttpError('Time off must have id, date and positive hours');
        }
        if (!data.timeOff)
            data.timeOff = [];
        const existing = data.timeOff.find(t => t.id === body.id);
        if (existing)
            Object.assign(existing, body);
        else
            data.timeOff.push(body);
        return { success: true, timeOff: existing || body };
    }
    const timeOffIdMatch = path.match(/^\/api\/admin\/time-off\/([^/]+)$/);
    if (m === 'DELETE' && timeOffIdMatch) {
        const data = requireData();
        const before = (data.timeOff || []).length;
        data.timeOff = (data.timeOff || []).filter(t => t.id !== timeOffIdMatch[1]);
        return { success: true, removed: before - data.timeOff.length };
    }
    throw new HttpError(`Native API: no handler for ${m} ${path}`, 404);
}
const nativeAdapter = (config) => {
    return new Promise((resolve, reject) => {
        (async () => {
            const url = config.url || '';
            // Strip query string and resolve to a pathname.
            const path = (url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]) || '/';
            let body = config.data;
            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body);
                }
                catch { /* leave as string */ }
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
                });
            }
            catch (e) {
                const status = e instanceof HttpError ? e.status : 500;
                const err = new Error(e.message);
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
//# sourceMappingURL=nativeApi.js.map