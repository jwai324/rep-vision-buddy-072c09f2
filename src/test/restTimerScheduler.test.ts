import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
import { playRestTimerSoundNow, scheduleRestTimerSound } from '@/utils/restTimerSound';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import {
  ensureRestSchedule,
  isRestScheduled,
  recalcRestSchedule,
  releaseRestSchedule,
  setRestTimerHidden,
  subscribeRestSchedule,
} from '@/utils/restTimerScheduler';

const { FakeWorker, workers } = vi.hoisted(() => {
  type Msg = { type: string; startedAt?: number; durationMs?: number };
  class FakeWorker {
    posted: Msg[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor() { workers.push(this); }
    postMessage(msg: Msg) { this.posted.push(msg); }
    terminate() { /* noop */ }
    emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  }
  const workers: FakeWorker[] = [];
  return { FakeWorker, workers };
});

vi.mock('@/workers/restTimerWorker?worker', () => ({ default: FakeWorker }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/utils/restTimerSound', () => ({
  scheduleRestTimerSound: vi.fn(() => vi.fn()),
  playRestTimerSoundNow: vi.fn(),
}));

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  static created: Array<{ title: string; options?: NotificationOptions }> = [];
  static throwOnConstruct = false;
  constructor(title: string, options?: NotificationOptions) {
    if (FakeNotification.throwOnConstruct) throw new TypeError('Illegal constructor');
    FakeNotification.created.push({ title, options });
  }
}

const registration = { showNotification: vi.fn(async () => undefined) };

const worker = () => workers[workers.length - 1];
const cancelledWorker = () => worker().posted.some(m => m.type === 'cancel');
const flush = () => vi.advanceTimersByTimeAsync(0);

let visibility: DocumentVisibilityState = 'hidden';

const START = new Date('2026-09-17T12:00:00Z').getTime();
const schedule = (durationMs = 10_000, key = 'set-0-0-@' + START) => ({ key, startedAtEpoch: START, durationMs });

describe('restTimerScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, '{}');
    visibility = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    FakeNotification.permission = 'granted';
    FakeNotification.created = [];
    FakeNotification.throwOnConstruct = false;
    FakeNotification.requestPermission.mockClear();
    vi.stubGlobal('Notification', FakeNotification);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn(async () => registration) },
    });
    registration.showNotification.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(scheduleRestTimerSound).mockClear();
    vi.mocked(playRestTimerSoundNow).mockClear();
    setRestTimerHidden(false);
  });

  afterEach(() => {
    releaseRestSchedule();
    worker()?.posted.splice(0);
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('starts the worker, the sound and the permission prompt for a fresh rest', () => {
    FakeNotification.permission = 'default';
    ensureRestSchedule(schedule());
    expect(isRestScheduled(schedule().key)).toBe(true);
    expect(worker().posted).toContainEqual({ type: 'start', startedAt: START, durationMs: 10_000 });
    expect(scheduleRestTimerSound).toHaveBeenCalledWith(10);
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('re-attaching to the live key restarts nothing', () => {
    ensureRestSchedule(schedule());
    ensureRestSchedule(schedule());
    expect(scheduleRestTimerSound).toHaveBeenCalledTimes(1);
    expect(worker().posted.filter(m => m.type === 'start')).toHaveLength(1);
  });

  it('signals completion once when the timeout lands first and the worker follows', async () => {
    ensureRestSchedule(schedule());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Rest complete', expect.anything());
    expect(registration.showNotification).toHaveBeenCalledTimes(1);

    worker().emit({ type: 'done' });
    recalcRestSchedule();
    await flush();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(registration.showNotification).toHaveBeenCalledTimes(1);
  });

  it('signals completion once when the worker lands first and the throttled timeout follows', async () => {
    ensureRestSchedule(schedule());
    // A hidden tab: the clock moves on but the main-thread timeout has not fired.
    vi.setSystemTime(START + 10_050);
    worker().emit({ type: 'done' });
    await flush();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(registration.showNotification).toHaveBeenCalledTimes(1);
    expect(registration.showNotification).toHaveBeenCalledWith('Rest complete', expect.objectContaining({
      body: 'Time for your next set.',
      tag: 'rest-timer',
    }));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(registration.showNotification).toHaveBeenCalledTimes(1);
  });

  it('a late catch-up plays the sound now and says the rest finished while away', async () => {
    ensureRestSchedule(schedule());
    vi.setSystemTime(START + 30_000);
    recalcRestSchedule();
    await flush();
    expect(playRestTimerSoundNow).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Rest finished', expect.anything());
    expect(registration.showNotification).toHaveBeenCalledWith('Rest complete', expect.objectContaining({
      body: 'Your rest finished while you were away.',
    }));
    recalcRestSchedule();
    await flush();
    expect(playRestTimerSoundNow).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('a cold restore of a rest that already ended announces it without the catch-up sound', async () => {
    vi.setSystemTime(START + 60_000);
    ensureRestSchedule(schedule());
    await flush();
    expect(toast.success).toHaveBeenCalledWith('Rest finished', expect.anything());
    expect(playRestTimerSoundNow).not.toHaveBeenCalled();
    expect(scheduleRestTimerSound).not.toHaveBeenCalled();
  });

  it('falls back to the Notification constructor where there is no service worker', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    ensureRestSchedule(schedule());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeNotification.created).toHaveLength(1);
    expect(FakeNotification.created[0].title).toBe('Rest complete');
  });

  it('survives a platform whose Notification constructor throws', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    FakeNotification.throwOnConstruct = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ensureRestSchedule(schedule());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('raises no OS notification while the tab is visible', async () => {
    visibility = 'visible';
    ensureRestSchedule(schedule());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(registration.showNotification).not.toHaveBeenCalled();
    expect(FakeNotification.created).toHaveLength(0);
  });

  it('Hide Timers skips the sound, the permission prompt, the toast and the notification', async () => {
    FakeNotification.permission = 'default';
    setRestTimerHidden(true);
    ensureRestSchedule(schedule());
    expect(scheduleRestTimerSound).not.toHaveBeenCalled();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    FakeNotification.permission = 'granted';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).not.toHaveBeenCalled();
    expect(registration.showNotification).not.toHaveBeenCalled();
    expect(playRestTimerSoundNow).not.toHaveBeenCalled();
  });

  it('showing timers again mid-rest re-arms the sound for what is left', () => {
    setRestTimerHidden(true);
    ensureRestSchedule(schedule());
    vi.advanceTimersByTime(4_000);
    setRestTimerHidden(false);
    expect(scheduleRestTimerSound).toHaveBeenCalledTimes(1);
    expect(scheduleRestTimerSound).toHaveBeenCalledWith(6);
  });

  it('release cancels the sound, the timeout and the worker', async () => {
    const cancel = vi.fn();
    vi.mocked(scheduleRestTimerSound).mockReturnValueOnce(cancel);
    ensureRestSchedule(schedule());
    releaseRestSchedule();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelledWorker()).toBe(true);
    expect(isRestScheduled(schedule().key)).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a new key replaces the live rest', () => {
    const cancel = vi.fn();
    vi.mocked(scheduleRestTimerSound).mockReturnValueOnce(cancel);
    ensureRestSchedule(schedule());
    ensureRestSchedule(schedule(20_000, 'set-0-1-@' + START));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(isRestScheduled(schedule().key)).toBe(false);
    expect(isRestScheduled('set-0-1-@' + START)).toBe(true);
  });

  it('a session discarded while minimized tears the rest down silently', async () => {
    const cancel = vi.fn();
    vi.mocked(scheduleRestTimerSound).mockReturnValueOnce(cancel);
    ensureRestSchedule(schedule());
    localStorage.removeItem(ACTIVE_SESSION_CACHE_KEY);
    vi.advanceTimersByTime(1_000);
    worker().emit({ type: 'tick', remainingMs: 9_000 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelledWorker()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).not.toHaveBeenCalled();
    expect(registration.showNotification).not.toHaveBeenCalled();
  });

  it('a rest with no session cache behind it is not treated as discarded', async () => {
    localStorage.removeItem(ACTIVE_SESSION_CACHE_KEY);
    ensureRestSchedule(schedule());
    vi.advanceTimersByTime(1_000);
    worker().emit({ type: 'tick', remainingMs: 9_000 });
    expect(isRestScheduled(schedule().key)).toBe(true);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on every tick until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRestSchedule(listener);
    ensureRestSchedule(schedule());
    worker().emit({ type: 'tick', remainingMs: 9_900 });
    worker().emit({ type: 'tick', remainingMs: 9_800 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    worker().emit({ type: 'tick', remainingMs: 9_700 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
