import { useEffect, useRef } from 'react';
import type { FinishedWorkout } from '@/utils/sessionCache';

/**
 * How long a failed auto-save waits before trying again on its own. Coming
 * back online or the tab becoming visible retries sooner; this is only the
 * backstop, kept slow because every failed save raises a toast.
 */
export const AUTO_SAVE_RETRY_MS = 5 * 60 * 1000;

/**
 * Saves a finished workout once its `autoSaveAt` has passed.
 *
 * A timer alone is not enough: a locked phone freezes the page and its
 * timers with it. So the deadline is checked again whenever the tab becomes
 * visible, and on mount — which is what catches a page the browser discarded
 * while it was frozen, on its next load. `save` resolves false when the write
 * did not land (or did not run); the hook then retries on reconnect, on
 * becoming visible, or after `AUTO_SAVE_RETRY_MS`.
 *
 * `ready` holds the save back until the app's data has loaded, the same point
 * at which a Save tap first becomes possible: the save ticks off the scheduled
 * workout it matches, and before the load there is no calendar to match.
 */
export function useFinishedAutoSave(
  finished: FinishedWorkout | null,
  ready: boolean,
  save: (finished: FinishedWorkout) => Promise<boolean>,
): void {
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  useEffect(() => {
    if (!finished || !ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let cancelled = false;

    const check = () => {
      if (cancelled || inFlight) return;
      clearTimeout(timer);
      const wait = finished.autoSaveAt - Date.now();
      if (wait > 0) {
        timer = setTimeout(check, wait);
        return;
      }
      inFlight = true;
      void saveRef.current(finished)
        .catch(() => false)
        .then(ok => {
          inFlight = false;
          if (!ok && !cancelled) timer = setTimeout(check, AUTO_SAVE_RETRY_MS);
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [finished, ready]);
}
