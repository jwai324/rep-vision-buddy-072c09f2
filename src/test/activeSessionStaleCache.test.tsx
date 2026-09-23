import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import { clearSessionCache } from '@/utils/sessionCache';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import type { ActiveSessionCache } from '@/types/activeSession';
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

const pushDay: WorkoutTemplate = {
  id: 'tpl-B',
  name: 'Push Day',
  exercises: [{
    exerciseId: 'flat-barbell-bench-press',
    sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90,
  }],
};

// The cache left behind by a different workout that was minimized, not finished.
const legDayCache = (): ActiveSessionCache => ({
  workoutName: 'Leg Day',
  startTimestamp: Date.now() - 60_000,
  elapsedAtCache: 60,
  templateId: 'tpl-A',
  blocks: [{
    exerciseId: 'barbell-back-squat',
    exerciseName: 'Barbell Back Squat',
    restSeconds: 90,
    sets: [{
      setNumber: 1, weight: '100', reps: '5', completed: false,
      type: 'normal', rpe: '', time: '',
    }],
  }],
});

const renderSession = (cachedSession: ActiveSessionCache | null) => render(
  <ActiveSession
    exercises={pushDay.exercises.map(e => e.exerciseId)}
    templateExercises={pushDay.exercises}
    templateName={pushDay.name}
    templateId={pushDay.id}
    template={pushDay}
    cachedSession={cachedSession}
    onFinish={vi.fn()}
    onCancel={vi.fn()}
    onMinimize={vi.fn()}
  />,
);

beforeEach(() => localStorage.clear());

describe('starting a workout while another is cached', () => {
  it('mounts the new template, not the workout left in the cache', () => {
    // Index only hands the cache to a screen that is resuming; this is the
    // component-level backstop for the same rule.
    renderSession(legDayCache());

    expect(screen.getByDisplayValue('Push Day 1')).toBeTruthy();
    expect(screen.queryByText(/Barbell Back Squat/i)).toBeNull();
    expect(screen.getAllByText(/Bench Press/i).length).toBeGreaterThan(0);
  });

  it('mounts nothing from the cache when Index withholds it for a fresh start', () => {
    renderSession(null);

    expect(screen.getByDisplayValue('Push Day 1')).toBeTruthy();
    expect(screen.queryByText(/Barbell Back Squat/i)).toBeNull();
  });

  it('still resumes a cache that belongs to this template', () => {
    renderSession({ ...legDayCache(), templateId: pushDay.id, workoutName: 'Push Day (resumed)' });

    expect(screen.getByDisplayValue('Push Day (resumed)')).toBeTruthy();
    expect(screen.getAllByText(/Barbell Back Squat/i).length).toBeGreaterThan(0);
  });
});

describe('a workout finished and saved while a debounced write is still pending', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not resurrect the cache Save just cleared', () => {
    renderSession(null);

    // An edit schedules the 500ms debounced cache write.
    fireEvent.change(screen.getByDisplayValue('Push Day 1'), { target: { value: 'Push Day 1 (done)' } });

    // Save resolves and the parent clears the cache — the same instant
    // clearSessionCache() runs in Index.tsx's onSave, before the screen has
    // actually unmounted ActiveSession.
    act(() => clearSessionCache());
    expect(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY)).toBeNull();

    // The debounce timer scheduled before the clear still fires on its own
    // schedule; it must not write the cache back.
    act(() => { vi.advanceTimersByTime(500); });
    expect(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY)).toBeNull();
  });
});
