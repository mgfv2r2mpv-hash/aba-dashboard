// Tiny key/value blob store for small secrets (PIN verifier, the encrypted
// schedule, the Face ID preference). On Capacitor native it persists to the
// app's private Data directory (covered by iOS Data Protection — encrypted at
// rest while the device is locked). On web it falls back to localStorage, which
// is only used for graceful degradation: the real lock flow is native-only.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
// Namespaced so a stray file in Directory.Data can't collide with ours.
const PREFIX = 'lock_';
export async function readBlob(name) {
    const path = PREFIX + name;
    if (Capacitor.isNativePlatform()) {
        try {
            const res = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
            return typeof res.data === 'string' ? res.data : null;
        }
        catch {
            // Missing file (or unreadable) — treat as "not set".
            return null;
        }
    }
    try {
        return localStorage.getItem(path);
    }
    catch {
        return null;
    }
}
export async function writeBlob(name, value) {
    const path = PREFIX + name;
    if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({ path, directory: Directory.Data, encoding: Encoding.UTF8, data: value });
        return;
    }
    try {
        localStorage.setItem(path, value);
    }
    catch { /* ignore */ }
}
export async function deleteBlob(name) {
    const path = PREFIX + name;
    if (Capacitor.isNativePlatform()) {
        try {
            await Filesystem.deleteFile({ path, directory: Directory.Data });
        }
        catch { /* already gone */ }
        return;
    }
    try {
        localStorage.removeItem(path);
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=secureStore.js.map