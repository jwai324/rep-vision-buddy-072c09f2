import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import type { WorkoutTemplate } from '@/types/workout';

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

const template: WorkoutTemplate = {
  id: 'tpl-1',
  name: 'Push',
  exercises: [{
    exerciseId: 'flat-barbell-bench-press',
    sets: 3,
    targetReps: 10,
    setType: 'normal',
    restSeconds: 90,
  }],
};

describe('active session timer resumed from a minimized cache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('shows elapsed time from the true start instant, not a stale debounced snapshot', () => {
    // The workout truly started an hour ago (startTimestamp), matching what
    // MinimizedSessionBar reads directly. elapsedAtCache is a much smaller
    // number here, simulating the debounced cache write that lagged behind
    // because nothing else changed for a while before the session was minimized.
    const staleCache = {
      blocks: [{
        exerciseId: 'flat-barbell-bench-press',
        exerciseName: 'Bench Press',
        restSeconds: 90,
        sets: [{ setNumber: 1, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' }],
      }],
      workoutName: 'Push',
      startTimestamp: Date.now() - 3_600_000,
      elapsedAtCache: 120,
      templateId: 'tpl-1',
    };

    render(
      <ActiveSession
        exercises={[] as never}
        templateId="tpl-1"
        template={template}
        weightUnit="lbs"
        cachedSession={staleCache as never}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Immediately on reopening, before any tick, the display should already
    // reflect the true ~1 hour elapsed rather than the stale 2:00 snapshot.
    expect(screen.getByText('60:00')).toBeInTheDocument();
    expect(screen.queryByText('2:00')).not.toBeInTheDocument();

    // And it keeps ticking forward from that correct anchor, not from the
    // stale one.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('60:01')).toBeInTheDocument();
  });

  it('keeps a paused resume frozen at the saved snapshot', () => {
    const pausedCache = {
      blocks: [{
        exerciseId: 'flat-barbell-bench-press',
        exerciseName: 'Bench Press',
        restSeconds: 90,
        sets: [{ setNumber: 1, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' }],
      }],
      workoutName: 'Push',
      startTimestamp: Date.now() - 3_600_000,
      elapsedAtCache: 120,
      timerPaused: true,
      pausedElapsedSec: 120,
      templateId: 'tpl-1',
    };

    render(
      <ActiveSession
        exercises={[] as never}
        templateId="tpl-1"
        template={template}
        weightUnit="lbs"
        cachedSession={pausedCache as never}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('2:00')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('2:00')).toBeInTheDocument();
  });
});
