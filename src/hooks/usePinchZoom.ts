// Scoped pinch-to-zoom for a scroll pane (e.g. a calendar time grid).
//
// The app shell itself must NOT zoom — index.html locks the viewport
// (user-scalable=no) and sets touch-action: pan-x pan-y. This hook gives one
// element back a *custom* pinch zoom that the caller maps onto its own layout
// (the calendars multiply their hour-height by `scale`), so the frozen header
// and time-axis panes stay aligned because they read the same scaled value.
//
// Gesture model (the key fix): a two-finger gesture is ambiguous — it could be a
// PAN (scroll) or a PINCH (zoom). We watch the distance between the two fingers:
//   - distance roughly constant → it's a pan; we do nothing and let the browser
//     scroll natively (momentum preserved).
//   - distance changes past a threshold → it's a pinch; we take over, zoom, and
//     preventDefault (when still cancelable) so the pane stops scroll-fighting.
//   - three fingers → reset to 1× (the "three-finger expand to reset").
//
// Because we only preventDefault once a pinch is *confirmed*, ordinary two-finger
// drag-scroll keeps working.

import { useEffect, useRef, useState, useCallback } from 'react';

interface PinchZoomOptions { min?: number; max?: number; }
interface PinchZoom<T extends HTMLElement> {
  ref: React.RefObject<T | null>;
  scale: number;
  zoomed: boolean;
  reset: () => void;
}

const DEFAULT_MIN = 0.5;
const DEFAULT_MAX = 2.5;
const DECIDE_PX = 14; // distance change that commits the gesture to "pinch"

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function dist(t: TouchList) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }

export function usePinchZoom<T extends HTMLElement = HTMLDivElement>(
  { min = DEFAULT_MIN, max = DEFAULT_MAX }: PinchZoomOptions = {},
): PinchZoom<T> {
  const ref = useRef<T | null>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  const apply = useCallback((next: number) => {
    const c = clamp(next, min, max);
    scaleRef.current = c;
    setScale(c);
  }, [min, max]);

  const reset = useCallback(() => apply(1), [apply]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startDist = 0;
    let startScale = 1;
    let mode: 'none' | 'undecided' | 'pinch' | 'pan' = 'none';
    let raf = 0;
    let pending = 1;
    const flush = () => { raf = 0; apply(pending); };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 3) { mode = 'none'; apply(1); return; }
      if (e.touches.length === 2) {
        startDist = dist(e.touches) || 1;
        startScale = scaleRef.current;
        mode = 'undecided';
      }
    };

    const onMove = (e: TouchEvent) => {
      if (mode === 'none' || mode === 'pan' || e.touches.length !== 2) return;
      const d = dist(e.touches);
      if (mode === 'undecided') {
        if (Math.abs(d - startDist) > DECIDE_PX) mode = 'pinch';
        else return; // still ambiguous → leave it to native scroll
      }
      // confirmed pinch
      if (e.cancelable) e.preventDefault();
      pending = clamp(startScale * (d / startDist), min, max);
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) mode = 'none'; };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [apply, min, max]);

  return { ref, scale, zoomed: scale !== 1, reset };
}
