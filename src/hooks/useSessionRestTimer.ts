import { useState, useCallback, useRef, useEffect } from 'react';
import type { PersistedTimer, ActiveSessionCache } from '@/types/activeSession';
import { timerIdKey } from '@/components/ExerciseTableComponent';
import type { TimerId } from '@/components/ExerciseRestTimer';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import {
  ensureRestSchedule,
  recalcRestSchedule,
  releaseRestSchedule,
  setRestTimerHidden,
  subscribeRestSchedule,
} from '@/utils/restTimerScheduler';

interface UseSessionRestTimerOptions {
  cachedSession?: ActiveSessionCache | null;
  hideTimers?: boolean;
}

// A rest is identified by its set and the instant it started, so an extend
// (which restarts the clock) is a new rest and a remount of the same one is
// not.
const scheduleOf = (t: PersistedTimer) => ({
  key: `${timerIdKey(t.id)}@${t.startedAtEpoch}`,
  startedAtEpoch: t.startedAtEpoch,
  durationMs: t.duration * 1000,
});

const sessionCacheExists = (): boolean => {
  try {
    return localStorage.getItem(ACTIVE_SESSION_CACHE_KEY) !== null;
  } catch {
    return false;
  }
};

/**
 * Rest-timer state for a live session. The scheduling that must survive this
 * hook (worker, sound, notification) lives in `restTimerScheduler`; this hook
 * only owns the React state and hands the scheduler the rest's identity.
 */
export function useSessionRestTimer({ cachedSession, hideTimers = false }: UseSessionRestTimerOptions) {
  const [activeTimer, setActiveTimerState] = useState<PersistedTimer | null>(
    cachedSession?.activeTimer ?? null
  );
  const [restRecords, setRestRecords] = useState<Record<string, number>>(
    cachedSession?.restRecords ?? {}
  );
  const [, setTimerTick] = useState(0);
  // The controls read the current timer from here rather than from a state
  // updater, so scheduling stays outside React's (StrictMode-doubled) updaters.
  const activeTimerRef = useRef<PersistedTimer | null>(activeTimer);

  const setActiveTimer = useCallback((next: PersistedTimer | null) => {
    activeTimerRef.current = next;
    setActiveTimerState(next);
  }, []);

  useEffect(() => { setRestTimerHidden(hideTimers); }, [hideTimers]);

  const computeRemaining = useCallback((t: PersistedTimer | null): number => {
    if (!t) return 0;
    if (t.status === 'paused') {
      return t.originalDuration - (t.elapsedAtPause ?? 0);
    }
    if (t.status !== 'running' || !t.startedAtEpoch) return 0;
    const target = t.startedAtEpoch + t.duration * 1000;
    const remainingMs = target - Date.now();
    return Math.min(t.originalDuration, Math.ceil(remainingMs / 1000));
  }, []);

  const recordRest = useCallback((t: PersistedTimer) => {
    const taken = t.status === 'paused'
      ? (t.elapsedAtPause ?? 0)
      : t.originalDuration - computeRemaining(t);
    setRestRecords(r => ({ ...r, [timerIdKey(t.id)]: Math.max(0, Math.round(taken)) }));
  }, [computeRemaining]);

  const recalcRestTimer = useCallback(() => {
    const t = activeTimerRef.current;
    if (!t || t.status !== 'running') return;
    recalcRestSchedule();
    setTimerTick(n => (n + 1) % 1000000);
  }, []);

  // Public timer controls
  const startTimer = useCallback((id: TimerId, duration: number) => {
    const prev = activeTimerRef.current;
    if (prev && prev.status === 'running') recordRest(prev);
    const next: PersistedTimer = {
      id,
      startedAtEpoch: Date.now(),
      duration,
      originalDuration: duration,
      status: 'running',
    };
    setActiveTimer(next);
    // Scheduled here, inside the tap, rather than from the sync effect below,
    // so the notification permission prompt is raised from the user gesture.
    ensureRestSchedule(scheduleOf(next));
  }, [recordRest, setActiveTimer]);

  const skipTimer = useCallback(() => {
    const prev = activeTimerRef.current;
    if (prev) recordRest(prev);
    setActiveTimer(null);
    releaseRestSchedule();
  }, [recordRest, setActiveTimer]);

  const extendTimer = useCallback((delta: number = 30) => {
    const prev = activeTimerRef.current;
    if (!prev) return;
    const newOriginal = Math.max(1, prev.originalDuration + delta);
    if (prev.status !== 'running') {
      setActiveTimer({ ...prev, originalDuration: newOriginal });
      return;
    }
    const newRemaining = Math.max(1, computeRemaining(prev) + delta);
    const next: PersistedTimer = {
      ...prev,
      originalDuration: newOriginal,
      duration: newRemaining,
      startedAtEpoch: Date.now(),
      status: 'running',
    };
    setActiveTimer(next);
    ensureRestSchedule(scheduleOf(next));
  }, [computeRemaining, setActiveTimer]);

  const pauseTimer = useCallback(() => {
    const prev = activeTimerRef.current;
    if (!prev || prev.status !== 'running') return;
    const elapsedAtPause = prev.originalDuration - computeRemaining(prev);
    releaseRestSchedule();
    setActiveTimer({
      ...prev,
      status: 'paused',
      startedAtEpoch: 0,
      elapsedAtPause: Math.max(0, elapsedAtPause),
    });
  }, [computeRemaining, setActiveTimer]);

  const resumeTimer = useCallback(() => {
    const prev = activeTimerRef.current;
    if (!prev || prev.status !== 'paused') return;
    const elapsed = prev.elapsedAtPause ?? 0;
    const next: PersistedTimer = {
      ...prev,
      status: 'running',
      startedAtEpoch: Date.now(),
      duration: Math.max(1, prev.originalDuration - elapsed),
      elapsedAtPause: undefined,
    };
    setActiveTimer(next);
    ensureRestSchedule(scheduleOf(next));
  }, [setActiveTimer]);

  // Hydrate on mount: a cached rest that has already run out is recorded and
  // cleared. Whether its ending still needs announcing is the scheduler's
  // call (the sync effect below hands it the rest): a live schedule already
  // signalled once while this screen was minimized, a cold restore has not.
  useEffect(() => {
    const t = activeTimerRef.current;
    if (!t || t.status !== 'running' || computeRemaining(t) > 0) return;
    setRestRecords(r => ({ ...r, [timerIdKey(t.id)]: t.originalDuration }));
    setActiveTimer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the scheduler attached to the timer's wall-clock identity: on mount
  // (re-attaching to a rest that ran on while minimized) and when the timer
  // changes outside the controls above (cross-tab cache sync). A running rest
  // the scheduler already holds is left alone.
  useEffect(() => {
    if (activeTimer?.status === 'running') {
      ensureRestSchedule(scheduleOf(activeTimer));
    } else if (activeTimer?.status === 'paused') {
      releaseRestSchedule();
    }
    // We intentionally depend on the primitive fields, not the `activeTimer`
    // object itself, so this effect re-runs only when the timer's
    // wall-clock identity changes — not on every fast-changing tick render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTimer?.id.type, activeTimer?.id.blockIdx, activeTimer?.id.setIdx, activeTimer?.id.dropIdx, activeTimer?.status, activeTimer?.startedAtEpoch, activeTimer?.duration]);

  // Re-render on the scheduler's ticks so the countdown stays smooth.
  useEffect(() => subscribeRestSchedule(() => {
    setTimerTick(n => (n + 1) % 1000000);
  }), []);

  // Visibility / focus / cross-tab listeners — these are the catch-up path
  // when the main thread was throttled while the tab was hidden. The worker
  // posts ticks that queue while hidden, but a single recalcRestTimer here
  // shortcuts the post-resume drain.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recalcRestTimer();
    };
    const onFocus = () => recalcRestTimer();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVE_SESSION_CACHE_KEY || !e.newValue) return;
      try {
        const parsed: ActiveSessionCache = JSON.parse(e.newValue);
        if (parsed.activeTimer !== undefined) {
          const next = parsed.activeTimer ?? null;
          setActiveTimer(next);
          if (!next) releaseRestSchedule();
        }
        if (parsed.restRecords) {
          setRestRecords(parsed.restRecords);
        }
      } catch {
        // ignore malformed
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [recalcRestTimer, setActiveTimer]);

  // Unmount is either the session being minimized (its cache stays, and so
  // does the rest — sound, notification and worker keep running until the
  // screen comes back) or the session ending (Index clears the cache before
  // it changes screen, so the cache is already gone here).
  useEffect(() => () => {
    if (!sessionCacheExists()) releaseRestSchedule();
  }, []);

  return {
    activeTimer,
    restRecords,
    computeRemaining,
    recalcRestTimer,
    startTimer,
    skipTimer,
    extendTimer,
    pauseTimer,
    resumeTimer,
  };
}
