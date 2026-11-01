import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, act } from '@testing-library/react';
import { useFinishedAutoSave, AUTO_SAVE_RETRY_MS } from '@/hooks/useFinishedAutoSave';
import {
  clearSessionCache, getFinishedWorkout, setFinishedWorkout,
  FINISHED_AUTO_SAVE_MS, type FinishedWorkout,
} from '@/utils/sessionCache';
import { ACTIVE_SESSION_CACHE_KEY, FINISHED_WORKOUT_KEY, USER_DRAFT_KEYS } from '@/utils/localDrafts';
import { SessionSummary } from '@/components/SessionSummary';
import type { WorkoutSession } from '@/types/workout';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const session: WorkoutSession = {
  id: 'sess-1', date: '2026-11-01', startedAt: '2026-11-01T09:00:00.000Z', duration: 3600,
  exercises: [{
    exerciseId: 'flat-barbell-bench-press', exerciseName: 'Flat Barbell Bench Press',
    sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }],
  }],
  totalVolume: 480, totalSets: 1, totalReps: 8,
};

const T0 = new Date('2026-11-01T10:00:00Z').getTime();
const finishedAt = (at: number): FinishedWorkout => ({ session, templateId: 'tpl-1', autoSaveAt: at + FINISHED_AUTO_SAVE_MS });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('useFinishedAutoSave', () => {
  it('saves once the ten minutes are up, not before', async () => {
    const save = vi.fn().mockResolvedValue(true);
    renderHook(() => useFinishedAutoSave(finishedAt(T0), true, save));

    await act(async () => { vi.advanceTimersByTime(FINISHED_AUTO_SAVE_MS - 1000); });
    expect(save).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(finishedAt(T0));
  });

  it('saves on the next load when the deadline passed while the page was gone', async () => {
    // A tab discarded while the phone was locked comes back as a fresh mount.
    const save = vi.fn().mockResolvedValue(true);
    vi.setSystemTime(T0 + FINISHED_AUTO_SAVE_MS + 60_000);
    renderHook(() => useFinishedAutoSave(finishedAt(T0), true, save));
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves when the screen comes back on after the timer was frozen past the deadline', async () => {
    const save = vi.fn().mockResolvedValue(true);
    renderHook(() => useFinishedAutoSave(finishedAt(T0), true, save));

    // A locked phone freezes timers: the clock moves on, nothing fires.
    vi.setSystemTime(T0 + FINISHED_AUTO_SAVE_MS + 5 * 60_000);
    expect(save).not.toHaveBeenCalled();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('waits for the data to load before saving', async () => {
    const save = vi.fn().mockResolvedValue(true);
    vi.setSystemTime(T0 + FINISHED_AUTO_SAVE_MS);
    const { rerender } = renderHook(({ ready }) => useFinishedAutoSave(finishedAt(T0), ready, save), {
      initialProps: { ready: false },
    });
    await act(async () => {});
    expect(save).not.toHaveBeenCalled();

    rerender({ ready: true });
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('retries a failed save on reconnect and on its own backstop', async () => {
    const save = vi.fn().mockResolvedValue(false);
    vi.setSystemTime(T0 + FINISHED_AUTO_SAVE_MS);
    renderHook(() => useFinishedAutoSave(finishedAt(T0), true, save));
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(save).toHaveBeenCalledTimes(2);

    await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_RETRY_MS); });
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('does nothing once the summary has been answered', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { rerender } = renderHook(({ fw }) => useFinishedAutoSave(fw, true, save), {
      initialProps: { fw: finishedAt(T0) as FinishedWorkout | null },
    });
    rerender({ fw: null });
    await act(async () => { vi.advanceTimersByTime(FINISHED_AUTO_SAVE_MS * 2); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('the persisted finished workout', () => {
  it('survives a reload while its workout cache does', () => {
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, '{}');
    setFinishedWorkout(finishedAt(T0));
    expect(getFinishedWorkout()).toEqual(finishedAt(T0));
  });

  it('is dropped when its workout cache is gone, so a discarded workout never saves', () => {
    setFinishedWorkout(finishedAt(T0));
    expect(getFinishedWorkout()).toBeNull();
    expect(localStorage.getItem(FINISHED_WORKOUT_KEY)).toBeNull();
  });

  it('goes with the session cache on every path that ends the workout', () => {
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, '{}');
    setFinishedWorkout(finishedAt(T0));
    clearSessionCache();
    expect(localStorage.getItem(FINISHED_WORKOUT_KEY)).toBeNull();
  });

  it('is cleared on sign-out with the other per-user drafts', () => {
    expect(USER_DRAFT_KEYS).toContain(FINISHED_WORKOUT_KEY);
  });
});

describe('Workout Complete screen', () => {
  it('offers Save Workout at the top as well as the bottom, both saving', () => {
    const onSave = vi.fn();
    render(<SessionSummary session={session} onSave={onSave} onSaveAsTemplate={vi.fn()} onClose={vi.fn()} autoSaveAt={T0 + FINISHED_AUTO_SAVE_MS} />);

    const buttons = screen.getAllByRole('button', { name: 'Save Workout' });
    expect(buttons).toHaveLength(2);
    buttons.forEach(b => fireEvent.click(b));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Saves automatically at/)).toBeTruthy();
  });

  it('shows neither in a saved workout\'s detail view', () => {
    render(<SessionSummary session={session} isViewMode onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save Workout' })).toBeNull();
    expect(screen.queryByText(/Saves automatically/)).toBeNull();
  });
});
