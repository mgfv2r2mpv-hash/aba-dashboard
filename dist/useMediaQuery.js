import { useState, useEffect } from 'react';
import { registerPlugin } from '@capacitor/core';
// Reactive `(min-width: Npx)` media query. Used to adapt the layout on larger
// screens (iPad and up) — e.g. docking a persistent context pane and giving the
// calendar grid roomier rows.
export function useMinWidth(px) {
    const query = `(min-width: ${px}px)`;
    const [matches, setMatches] = useState(() => typeof window === 'undefined' ? false : window.matchMedia(query).matches);
    useEffect(() => {
        if (typeof window === 'undefined')
            return;
        const mq = window.matchMedia(query);
        const handler = (e) => setMatches(e.matches);
        setMatches(mq.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [query]);
    return matches;
}
let devicePlugin;
function getDevicePlugin() {
    if (devicePlugin === undefined) {
        try {
            devicePlugin = registerPlugin('Device');
        }
        catch {
            devicePlugin = null;
        }
    }
    return devicePlugin;
}
// Synchronous best-guess from UA + touch capability. iPadOS in "desktop site"
// mode masquerades as Macintosh, but it's the only "Mac" with a touchscreen, so
// `Macintosh + maxTouchPoints>1` is the canonical iPad tell. Android tablets are
// "Android" without the "Mobile" token that phones carry.
export function guessDeviceClass() {
    if (typeof navigator === 'undefined')
        return 'desktop';
    const ua = navigator.userAgent || '';
    const touch = (navigator.maxTouchPoints || 0) > 1;
    if (/\biPad\b/.test(ua) || (/\bMacintosh\b/.test(ua) && touch))
        return 'tablet';
    if (/\bAndroid\b/.test(ua))
        return /\bMobile\b/.test(ua) ? 'phone' : 'tablet';
    if (/\b(iPhone|iPod)\b/.test(ua))
        return 'phone';
    return 'desktop';
}
// Authoritative refinement via the native plugin; resolves null when unavailable
// (web, or pod not installed) so the caller keeps the synchronous guess.
async function nativeDeviceClass() {
    const plugin = getDevicePlugin();
    if (!plugin)
        return null;
    try {
        const info = await plugin.getInfo();
        const model = (info.model || '').toLowerCase();
        const os = (info.operatingSystem || '').toLowerCase();
        if (/ipad/.test(model))
            return 'tablet';
        if (/iphone|ipod/.test(model))
            return 'phone';
        // Capacitor exposes no phone/tablet idiom for Android; the UA split is all
        // we need to separate the two.
        if (os === 'android')
            return guessDeviceClass();
        return null;
    }
    catch {
        return null;
    }
}
// Reactive orientation hook — true while device is in landscape.
export function useIsLandscape() {
    const [landscape, setLandscape] = useState(() => typeof window === 'undefined' ? false : window.matchMedia('(orientation: landscape)').matches);
    useEffect(() => {
        if (typeof window === 'undefined')
            return;
        const mq = window.matchMedia('(orientation: landscape)');
        const handler = (e) => setLandscape(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return landscape;
}
// True for iPad / Android tablets. Seeds synchronously from the UA heuristic,
// then upgrades to the native plugin's verdict once it resolves.
export function useIsTablet() {
    const [cls, setCls] = useState(() => guessDeviceClass());
    useEffect(() => {
        let alive = true;
        nativeDeviceClass().then(n => { if (alive && n)
            setCls(n); });
        return () => { alive = false; };
    }, []);
    return cls === 'tablet';
}
//# sourceMappingURL=useMediaQuery.js.map