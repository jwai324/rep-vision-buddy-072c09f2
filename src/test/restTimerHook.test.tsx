import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { playRestTimerSoundNow, scheduleRestTimerSound } from '@/utils/restTimerSound';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import { releaseRestSchedule, setRestTimerHidden } from '@/utils/restTimerScheduler';
import { useSessionRestTimer } from '@/hooks/useSessionRestTimer';
import type { ActiveSessionCache, PersistedTimer } from '@/types/activeSession';

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

const START = new Date('2026-09-17T12:00:00Z').getTime();
const SET_ONE = { type: 'set' as const, blockIdx: 0, setIdx: 0 };
const worker = () => workers[workers.length - 1];
const workerCancelled = () => worker()?.posted.some(m => m.type === 'cancel') ?? false;
const lastSoundCancel = () => vi.mocked(scheduleRestTimerSound).mock.results.at(-1)?.value as ReturnType<typeof vi.fn>;

// What ActiveSession's debounced cache writer would have persisted for the
// hook's current timer, so a remount hydrates from the same rest.
const cacheWith = (activeTimer: PersistedTimer | null): ActiveSessionCache => ({
  blocks: [],
  workoutName: 'Push',
  startTimestamp: START - 60_000,
  elapsedAtCache: 60,
  activeTimer,
});

const mountHook = (cachedSession: ActiveSessionCache | null = null, hideTimers = false) =>
  renderHook((props: { cachedSession: ActiveSessionCache | null; hideTimers: boolean }) => useSessionRestTimer(props), {
    initialProps: { cachedSession, hideTimers },
  });

describe('useSessionRestTimer and the schedule that outlives it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cacheWith(null)));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    vi.mocked(toast.success).mockClear();
    vi.mocked(scheduleRestTimerSound).mockClear();
    vi.mocked(playRestTimerSoundNow).mockClear();
    setRestTimerHidden(false);
  });

  afterEach(() => {
    releaseRestSchedule();
    worker()?.posted.splice(0);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('a minimized session keeps its rest running and re-attaches on expand', async () => {
    const first = mountHook();
    act(() => { first.result.current.startTimer(SET_ONE, 30); });
    const timer = first.result.current.activeTimer;
    expect(timer?.status).toBe('running');
    expect(scheduleRestTimerSound).toHaveBeenCalledTimes(1);
    const cancelSound = lastSoundCancel();
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cacheWith(timer)));

    // Minimize: the hook unmounts, the rest does not stop.
    first.unmount();
    expect(cancelSound).not.toHaveBeenCalled();
    expect(workerCancelled()).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);

    // Expand: the same rest is picked up, not restarted.
    const second = mountHook(cacheWith(timer));
    expect(second.result.current.activeTimer?.startedAtEpoch).toBe(START);
    expect(second.result.current.computeRemaining(second.result.current.activeTimer)).toBe(20);
    expect(scheduleRestTimerSound).toHaveBeenCalledTimes(1);
    expect(worker().posted.filter(m => m.type === 'start')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Rest complete', expect.anything());
    second.unmount();
  });

  it('a rest that ends while minimized is announced once, not again on expand', async () => {
    const first = mountHook();
    act(() => { first.result.current.startTimer(SET_ONE, 30); });
    const timer = first.result.current.activeTimer;
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cacheWith(timer)));
    first.unmount();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(toast.success).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    const second = mountHook(cacheWith(timer));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(second.result.current.activeTimer).toBeNull();
    expect(second.result.current.restRecords['set-0-0-']).toBe(30);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(playRestTimerSoundNow).not.toHaveBeenCalled();
    second.unmount();
  });

  it('a cold restore of an expired rest announces it late, once', async () => {
    const expired: PersistedTimer = {
      id: SET_ONE, startedAtEpoch: START - 90_000, duration: 60, originalDuration: 60, status: 'running',
    };
    const hook = mountHook(cacheWith(expired));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.activeTimer).toBeNull();
    expect(hook.result.current.restRecords['set-0-0-']).toBe(60);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Rest finished', expect.anything());
    expect(scheduleRestTimerSound).not.toHaveBeenCalled();
    hook.rerender({ cachedSession: cacheWith(expired), hideTimers: false });
    expect(toast.success).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('the worker tick and the completion timeout together fire the signal once', async () => {
    const hook = mountHook();
    act(() => { hook.result.current.startTimer(SET_ONE, 10); });
    vi.setSystemTime(START + 10_020);
    act(() => { worker().emit({ type: 'done' }); });
    act(() => { hook.result.current.recalcRestTimer(); });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast.success).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('ending the session (cache cleared before unmount) tears the rest down', () => {
    const hook = mountHook();
    act(() => { hook.result.current.startTimer(SET_ONE, 30); });
    const cancelSound = lastSoundCancel();
    localStorage.removeItem(ACTIVE_SESSION_CACHE_KEY);
    hook.unmount();
    expect(cancelSound).toHaveBeenCalledTimes(1);
    expect(workerCancelled()).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('skip, pause and a new timer release the previous rest', () => {
    const hook = mountHook();
    act(() => { hook.result.current.startTimer(SET_ONE, 30); });
    const firstCancel = lastSoundCancel();
    act(() => { hook.result.current.pauseTimer(); });
    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.activeTimer?.status).toBe('paused');

    act(() => { hook.result.current.resumeTimer(); });
    expect(scheduleRestTimerSound).toHaveBeenCalledTimes(2);
    const secondCancel = lastSoundCancel();
    act(() => { hook.result.current.startTimer({ type: 'set', blockIdx: 0, setIdx: 1 }, 30); });
    expect(secondCancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.restRecords['set-0-0-']).toBe(0);

    const thirdCancel = lastSoundCancel();
    act(() => { hook.result.current.skipTimer(); });
    expect(thirdCancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.activeTimer).toBeNull();
    expect(workerCancelled()).toBe(true);
    hook.unmount();
  });

  it('Hide Timers starts the rest without sound or notification', async () => {
    const hook = mountHook(null, true);
    act(() => { hook.result.current.startTimer(SET_ONE, 5); });
    expect(hook.result.current.activeTimer?.status).toBe('running');
    expect(scheduleRestTimerSound).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(toast.success).not.toHaveBeenCalled();
    hook.unmount();
  });
});
