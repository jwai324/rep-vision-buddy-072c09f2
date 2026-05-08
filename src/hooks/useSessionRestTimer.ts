import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { PersistedTimer, ActiveSessionCache } from '@/types/activeSession';
import { timerIdKey } from '@/components/ExerciseTableComponent';
import type { TimerId } from '@/components/ExerciseRestTimer';

type TimerStatus = 'running' | 'paused' | 'completed';

interface UseSessionRestTimerOptions {
  cachedSession?: ActiveSessionCache | null;
}

export function useSessionRestTimer({ cachedSession }: UseSessionRestTimerOptions) {
  const [activeTimer, setActiveTimer] = useState<PersistedTimer | null>(
    cachedSession?.activeTimer ?? null
  );
  const [restRecords, setRestRecords] = useState<Record<string, number>>(
    cachedSession?.restRecords ?? {}
  );
  const [, setTimerTick] = useState(0);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const notificationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedFiredFor = useRef<Set<string>>(new Set());

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

  // Notification helpers
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

  const ensureNotificationPermission = useCallback(async () => {
    if (!notificationsSupported) return false;
    try {
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      const res = await Notification.requestPermission();
      return res === 'granted';
    } catch {
      return false;
    }
  }, [notificationsSupported]);

  const cancelNotification = useCallback(() => {
    if (notificationTimeout.current) {
      clearTimeout(notificationTimeout.current);
      notificationTimeout.current = null;
    }
  }, []);

  const fireRestCompleteNotification = useCallback((late: boolean = false) => {
    try {
      if (notificationsSupported && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification('Rest complete', {
          body: late ? 'Your rest finished while you were away.' : 'Time for your next set.',
          tag: 'rest-timer',
          silent: false,
        });
      }
    } catch (e) {
      console.warn('[ActiveSession] Notification failed:', e);
    }
    toast.success(late ? 'Rest finished' : 'Rest complete', {
      description: late ? 'Your rest finished while you were away.' : 'Time for your next set.',
    });
  }, [notificationsSupported]);

  const scheduleNotification = useCallback((msUntil: number) => {
    cancelNotification();
    if (msUntil <= 0) return;
    notificationTimeout.current = setTimeout(() => {
      fireRestCompleteNotification(false);
    }, msUntil);
  }, [cancelNotification, fireRestCompleteNotification]);

  const recalcRestTimer = useCallback(() => {
    setActiveTimer(prev => {
      if (!prev) return prev;
      if (prev.status !== 'running') return prev;
      const remaining = computeRemaining(prev);
      const key = `${timerIdKey(prev.id)}@${prev.startedAtEpoch}`;
      if (remaining <= 0 && !completedFiredFor.current.has(key)) {
        completedFiredFor.current.add(key);
        const target = prev.startedAtEpoch + prev.duration * 1000;
        const wasLate = Date.now() - target > 1500;
        if (wasLate) fireRestCompleteNotification(true);
        cancelNotification();
      }
      setTimerTick(n => (n + 1) % 1000000);
      return prev;
    });
  }, [computeRemaining, cancelNotification, fireRestCompleteNotification]);

  // Public timer controls
  const startTimer = useCallback((id: TimerId, duration: number) => {
    cancelNotification();
    setActiveTimer(prev => {
      if (prev && prev.status === 'running') {
        const taken = prev.originalDuration - computeRemaining(prev);
        setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: Math.max(0, Math.round(taken)) }));
      }
      return null;
    });
    const now = Date.now();
    const newTimer: PersistedTimer = {
      id,
      startedAtEpoch: now,
      duration,
      originalDuration: duration,
      status: 'running',
    };
    setActiveTimer(newTimer);
    ensureNotificationPermission().finally(() => {
      scheduleNotification(duration * 1000);
    });
  }, [cancelNotification, computeRemaining, ensureNotificationPermission, scheduleNotification]);

  const skipTimer = useCallback(() => {
    cancelNotification();
    setActiveTimer(prev => {
      if (prev) {
        const taken = prev.status === 'paused'
          ? (prev.elapsedAtPause ?? 0)
          : prev.originalDuration - computeRemaining(prev);
        setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: Math.max(0, Math.round(taken)) }));
      }
      return null;
    });
  }, [cancelNotification, computeRemaining]);

  const extendTimer = useCallback((delta: number = 30) => {
    setActiveTimer(prev => {
      if (!prev) return prev;
      const newOriginal = Math.max(1, prev.originalDuration + delta);
      let next: PersistedTimer;
      if (prev.status === 'running') {
        const remaining = computeRemaining(prev);
        const newRemaining = Math.max(1, remaining + delta);
        const now = Date.now();
        next = {
          ...prev,
          originalDuration: newOriginal,
          duration: newRemaining,
          startedAtEpoch: now,
          status: 'running',
        };
        cancelNotification();
        scheduleNotification(newRemaining * 1000);
      } else {
        next = { ...prev, originalDuration: newOriginal };
      }
      return next;
    });
  }, [computeRemaining, cancelNotification, scheduleNotification]);

  const pauseTimer = useCallback(() => {
    cancelNotification();
    setActiveTimer(prev => {
      if (!prev || prev.status !== 'running') return prev;
      const remaining = computeRemaining(prev);
      const elapsedAtPause = prev.originalDuration - remaining;
      return {
        ...prev,
        status: 'paused',
        startedAtEpoch: 0,
        elapsedAtPause: Math.max(0, elapsedAtPause),
      };
    });
  }, [cancelNotification, computeRemaining]);

  const resumeTimer = useCallback(() => {
    setActiveTimer(prev => {
      if (!prev || prev.status !== 'paused') return prev;
      const elapsed = prev.elapsedAtPause ?? 0;
      const newDuration = Math.max(1, prev.originalDuration - elapsed);
      const now = Date.now();
      ensureNotificationPermission().finally(() => scheduleNotification(newDuration * 1000));
      return {
        ...prev,
        status: 'running',
        startedAtEpoch: now,
        duration: newDuration,
        elapsedAtPause: undefined,
      };
    });
  }, [ensureNotificationPermission, scheduleNotification]);

  // Hydrate on mount: reconcile if running timer expired while away
  useEffect(() => {
    const t = cachedSession?.activeTimer;
    if (!t || t.status !== 'running') return;
    const remaining = computeRemaining(t);
    if (remaining <= 0) {
      const key = `${timerIdKey(t.id)}@${t.startedAtEpoch}`;
      completedFiredFor.current.add(key);
      setRestRecords(r => ({ ...r, [timerIdKey(t.id)]: t.originalDuration }));
      setActiveTimer(null);
      fireRestCompleteNotification(true);
    } else {
      ensureNotificationPermission().finally(() => scheduleNotification(remaining * 1000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick interval — UI refresh only
  useEffect(() => {
    if (timerInterval.current) clearInterval(timerInterval.current);
    if (activeTimer && activeTimer.status === 'running') {
      timerInterval.current = setInterval(recalcRestTimer, 1000);
      recalcRestTimer();
    }
    return () => { if (timerInterval.current) clearInterval(timerInterval.current); };
  }, [activeTimer?.id.type, activeTimer?.id.blockIdx, activeTimer?.id.setIdx, activeTimer?.status, activeTimer?.startedAtEpoch, recalcRestTimer]);

  // Visibility / focus / cross-tab listeners
  useEffect(() => {
    const CACHE_KEY = 'active-session-cache';
    const onVisible = () => {
      if (document.visibilityState === 'visible') recalcRestTimer();
    };
    const onFocus = () => recalcRestTimer();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CACHE_KEY || !e.newValue) return;
      try {
        const parsed: ActiveSessionCache = JSON.parse(e.newValue);
        if (parsed.activeTimer !== undefined) {
          setActiveTimer(parsed.activeTimer ?? null);
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
  }, [recalcRestTimer]);

  // Cleanup notification timeout on unmount
  useEffect(() => () => cancelNotification(), [cancelNotification]);

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
