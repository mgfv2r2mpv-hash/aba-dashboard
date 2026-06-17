// Scoped pinch-to-zoom for a scroll pane (e.g. a calendar time grid).
//
// The app shell itself must NOT zoom — index.html locks the viewport
// (user-scalable=no) and sets touch-action: pan-x pan-y. This hook gives one
// element back a *custom* pinch zoom that the caller maps onto its own layout
// (the calendars multiply their hour-height by `scale`), so the frozen header
// and time-axis panes stay aligned because they read the same scaled value.
//
// Gestures:
//   - two-finger pinch  → zoom (clamped to [min, max])
//   - three-finger tap  → reset to 1 (the "three finger expand to reset")
//
// Touch listeners are attached natively (non-passive) so we can preventDefault
// during a pinch and stop the pane from scroll-fighting the gesture. Updates are
// throttled to one per animation frame to keep re-renders smooth.

import { useEffect, useRef, useState, useCallback } from 'react';

interface PinchZoomOptions {
  min?: number;
  max?: number;
}

interface PinchZoom<T extends HTMLElement> {
  ref: React.RefObject<T | null>;
  scale: number;
  zoomed: boolean;
  reset: () => void;
}

const DEFAULT_MIN = 0.5;
const DEFAULT_MAX = 2.5;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function touchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

export function usePinchZoom<T extends HTMLElement = HTMLDivElement>(
  { min = DEFAULT_MIN, max = DEFAULT_MAX }: PinchZoomOptions = {},
): PinchZoom<T> {
  const ref = useRef<T | null>(null);
  const [scale, setScale] = useState(1);
  // Mirror state in a ref so the (long-lived) touch listeners read the live
  // value without re-subscribing on every scale change.
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
    let pinching = false;
    let raf = 0;
    let pending = 0;

    const flush = () => { raf = 0; apply(pending); };

    const onStart = (e: TouchEvent) => {
      // Three (or more) fingers = reset zoom.
      if (e.touches.length >= 3) {
        pinching = false;
        e.preventDefault();
        apply(1);
        return;
      }
      if (e.touches.length === 2) {
        pinching = true;
        startDist = touchDistance(e.touches);
        startScale = scaleRef.current;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault(); // stop the pane from scrolling mid-pinch
      const ratio = touchDistance(e.touches) / (startDist || 1);
      pending = clamp(startScale * ratio, min, max);
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinching = false;
    };

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
