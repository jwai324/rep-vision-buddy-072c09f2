import { toast } from 'sonner';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import { playRestTimerSoundNow, scheduleRestTimerSound } from '@/utils/restTimerSound';
import RestTimerWorker from '@/workers/restTimerWorker?worker';

/**
 * Everything about a rest that has to outlive the screen showing it: the
 * worker that keeps time in a hidden tab, the scheduled sound and vibration,
 * and the "Rest complete" toast / OS notification.
 *
 * `useSessionRestTimer` used to own all of this, so minimizing the session —
 * which unmounts it — cancelled a running rest's sound, vibration, notification
 * and worker. Here it lives at module level, created by `ensureRestSchedule`
 * when a rest starts and torn down only when that rest is skipped, replaced,
 * paused or completed, or the session cache it belongs to is cleared. A
 * remounting hook re-attaches by key (`ensureRestSchedule` is a no-op for the
 * live key) rather than restarting.
 *
 * Completion is signalled from one place, `recalcRestSchedule`, when the
 * remaining time first reaches zero, and is idempotent per key: the worker's
 * "done", the completion timeout and the hook's visibility catch-up all route
 * through it, and whichever lands first fires the signal once. Before this,
 * the worker's "done" usually beat the throttled timeout in a hidden tab and
 * cancelled the OS notification it was racing.
 */
export interface RestSchedule {
  key: string;
  startedAtEpoch: number;
  durationMs: number;
}

interface LiveRest extends RestSchedule {
  completed: boolean;
  /**
   * Whether a session cache existed when the rest was scheduled. Only then is
   * a missing cache a signal that the workout was discarded (from the
   * minimized bar, or by sign-out) while nothing was mounted to release us;
   * edit mode never writes a cache and its rests are released on unmount.
   */
  cacheBacked: boolean;
  lastCacheCheck: number;
  cancelSound: (() => void) | null;
  completionTimeout: ReturnType<typeof setTimeout> | null;
}

// Signals later than this are "late": the tab was throttled or suspended
// past the target, so the scheduled sound/vibration likely never fired.
const LATE_MS = 1500;
const CACHE_CHECK_INTERVAL_MS = 1000;

let current: LiveRest | null = null;
let hidden = false;
// undefined: not tried yet; null: construction failed, main-thread timers only.
let worker: Worker | null | undefined;
const listeners = new Set<() => void>();

function cacheExists(): boolean {
  try {
    return localStorage.getItem(ACTIVE_SESSION_CACHE_KEY) !== null;
  } catch {
    return false;
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new RestTimerWorker();
    w.onmessage = (e: MessageEvent<{ type: 'tick'; remainingMs: number } | { type: 'done' }>) => {
      const msg = e.data;
      if (msg && (msg.type === 'tick' || msg.type === 'done')) recalcRestSchedule();
    };
    worker = w;
  } catch (e) {
    // Some older WebViews have no Worker; the completion timeout and the
    // hook's visibility catch-up still cover correctness, at lower precision.
    console.warn('[RestTimer] Worker unavailable, falling back to main-thread timers:', e);
    worker = null;
  }
  return worker;
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  try {
    // Old Safari's callback-style requestPermission returns undefined.
    void Promise.resolve(Notification.requestPermission()).catch(() => undefined);
  } catch {
    // ignore
  }
}

async function showOsNotification(late: boolean): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  const options: NotificationOptions = {
    body: late ? 'Your rest finished while you were away.' : 'Time for your next set.',
    tag: 'rest-timer',
    silent: false,
  };
  // Chrome for Android has no page-level Notification constructor (it throws
  // "Illegal constructor"); notifications there go through the service worker
  // registered in main.tsx. Desktop browsers without a registration keep the
  // constructor path.
  try {
    const registration = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration()
      : undefined;
    if (registration) {
      await registration.showNotification('Rest complete', options);
      return;
    }
  } catch {
    // fall through to the constructor
  }
  try {
    new Notification('Rest complete', options);
  } catch (e) {
    console.warn('[RestTimer] Notification failed:', e);
  }
}

function clearCompletionTimeout(rest: LiveRest): void {
  if (rest.completionTimeout !== null) {
    clearTimeout(rest.completionTimeout);
    rest.completionTimeout = null;
  }
}

function cancelSound(rest: LiveRest): void {
  rest.cancelSound?.();
  rest.cancelSound = null;
}

function complete(rest: LiveRest, now: number, catchUpSound: boolean): void {
  rest.completed = true;
  clearCompletionTimeout(rest);
  if (rest.cacheBacked && !cacheExists()) {
    // Discarded while minimized: nothing to announce.
    releaseRestSchedule();
    return;
  }
  if (hidden) return;
  const late = now - (rest.startedAtEpoch + rest.durationMs) > LATE_MS;
  if (late && catchUpSound) {
    // The vibration timeouts were throttled while hidden and Safari suspends
    // the AudioContext-scheduled source, so fire both now.
    cancelSound(rest);
    playRestTimerSoundNow();
  }
  toast.success(late ? 'Rest finished' : 'Rest complete', {
    description: late ? 'Your rest finished while you were away.' : 'Time for your next set.',
  });
  void showOsNotification(late);
}

function arm(rest: LiveRest, remainingMs: number): void {
  if (!hidden) {
    rest.cancelSound = scheduleRestTimerSound(remainingMs / 1000);
    requestNotificationPermission();
  }
  rest.completionTimeout = setTimeout(recalcRestSchedule, remainingMs);
  getWorker()?.postMessage({ type: 'start', startedAt: rest.startedAtEpoch, durationMs: rest.durationMs });
}

/**
 * Recompute the live rest against the clock and signal completion the first
 * time it has run out. Every tick source calls this; it is safe to call as
 * often as you like.
 */
export function recalcRestSchedule(): void {
  const rest = current;
  if (!rest || rest.completed) return;
  const now = Date.now();
  if (rest.cacheBacked && now - rest.lastCacheCheck >= CACHE_CHECK_INTERVAL_MS) {
    rest.lastCacheCheck = now;
    if (!cacheExists()) {
      releaseRestSchedule();
      return;
    }
  }
  if (rest.startedAtEpoch + rest.durationMs - now <= 0) complete(rest, now, true);
  notifyListeners();
}

/**
 * Attach to the live schedule for `schedule.key`, or start one. A rest that
 * is already over when it is first seen here (a cold restore of a cache whose
 * rest ended while the app was closed) is announced as late, without the
 * catch-up sound — the user has just opened the app.
 */
export function ensureRestSchedule(schedule: RestSchedule): void {
  if (current?.key === schedule.key) return;
  releaseRestSchedule();
  const now = Date.now();
  const rest: LiveRest = {
    ...schedule,
    completed: false,
    cacheBacked: cacheExists(),
    lastCacheCheck: now,
    cancelSound: null,
    completionTimeout: null,
  };
  current = rest;
  const remainingMs = rest.startedAtEpoch + rest.durationMs - now;
  if (remainingMs <= 0) {
    complete(rest, now, false);
    return;
  }
  arm(rest, remainingMs);
}

/** Tear down the live schedule, if any: sound, timeout and worker. */
export function releaseRestSchedule(): void {
  const rest = current;
  if (!rest) return;
  current = null;
  cancelSound(rest);
  clearCompletionTimeout(rest);
  worker?.postMessage({ type: 'cancel' });
}

export function isRestScheduled(key: string): boolean {
  return current?.key === key;
}

/**
 * "Hide Timers": no sound, no OS notification, no permission prompt and no
 * toast. Flipping it mid-rest re-arms or drops the sound for what is left.
 */
export function setRestTimerHidden(value: boolean): void {
  if (hidden === value) return;
  hidden = value;
  const rest = current;
  if (!rest || rest.completed) return;
  cancelSound(rest);
  if (!hidden) {
    const remainingMs = rest.startedAtEpoch + rest.durationMs - Date.now();
    if (remainingMs > 0) {
      rest.cancelSound = scheduleRestTimerSound(remainingMs / 1000);
      requestNotificationPermission();
    }
  }
}

/** Called on every tick of the live rest, so a mounted screen can re-render. */
export function subscribeRestSchedule(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
