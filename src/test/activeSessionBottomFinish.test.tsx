import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import { ActiveSession } from '@/components/ActiveSession';
import type { WorkoutSession } from '@/types/workout';
import type { ActiveSessionCache } from '@/types/activeSession';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSessionController', () => ({
  registerSession: vi.fn(),
  unregisterSession: vi.fn(),
}));

const cacheWith = (completed: boolean): ActiveSessionCache => ({
  workoutName: 'Push', startTimestamp: Date.now(), elapsedAtCache: 0,
  blocks: [{
    exerciseId: 'flat-barbell-bench-press', exerciseName: 'Flat Barbell Bench Press', restSeconds: 90,
    sets: [{ setNumber: 1, weight: '60', reps: '8', completed, type: 'normal', rpe: '', time: '' }],
  }],
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(toast.error).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('the Finish Workout button below the exercise list', () => {
  it('finishes the workout the same way the header button does', () => {
    const onFinish = vi.fn();
    render(<ActiveSession exercises={[]} cachedSession={cacheWith(true)} onFinish={onFinish} onCancel={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(60_000); });

    fireEvent.click(screen.getByText('Finish Workout'));

    expect(onFinish).toHaveBeenCalledTimes(1);
    const saved = onFinish.mock.calls[0][0] as WorkoutSession;
    expect(saved.exercises.map(e => e.exerciseId)).toEqual(['flat-barbell-bench-press']);
    expect(saved.duration).toBe(60);
  });

  it('obeys the same guards — nothing completed means nothing saved', () => {
    const onFinish = vi.fn();
    render(<ActiveSession exercises={[]} cachedSession={cacheWith(false)} onFinish={onFinish} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('Finish Workout'));

    expect(onFinish).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Complete at least one set or Discard this workout.');
  });

  it('is not shown when editing a past workout', () => {
    const past: WorkoutSession = {
      id: 'sess-1', date: '2026-10-30', startedAt: '2026-10-30T18:00:00.000Z', duration: 1800,
      exercises: [{
        exerciseId: 'flat-barbell-bench-press', exerciseName: 'Flat Barbell Bench Press',
        sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }],
      }],
      totalVolume: 480, totalSets: 1, totalReps: 8,
    };
    render(<ActiveSession exercises={[]} editSession={past} onFinish={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByText('Finish Workout')).toBeNull();
    expect(screen.getByText('Save Changes')).toBeTruthy();
  });
});
