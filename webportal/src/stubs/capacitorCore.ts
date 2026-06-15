// Minimal Capacitor Core stub for the web portal build.
// useMediaQuery.ts does `registerPlugin('Device')` and catches any error from
// the plugin's methods — so we return a proxy whose every method rejects, which
// causes nativeDeviceClass() to return null and fall back to the UA heuristic.
export function registerPlugin<T>(_name: string): T {
  const handler: ProxyHandler<object> = {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // not a Promise
      return () => Promise.reject(new Error(`Capacitor unavailable in browser`));
    },
  };
  return new Proxy({}, handler) as T;
}

export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web' as const,
};
