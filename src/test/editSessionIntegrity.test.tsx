import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
const registerSession = vi.fn();
vi.mock('@/hooks/useSessionController', () => ({
  registerSession: (...a: unknown[]) => registerSession(...a),
  unregisterSession: vi.fn(),
}));

const past: WorkoutSession = {
  id: 'sess-1',
  date: '2026-09-10',
  startedAt: '2026-09-10T18:05:00.000Z',
  duration: 1960, // 32:40
  location: 'Commercial Gym',
  isRestDay: false,
  recoveryActivities: [{ id: 'ra-1', activityId: 'foam-rolling', duration: 10 }],
  exercises: [{
    exerciseId: 'flat-barbell-bench-press', exerciseName: 'Flat Barbell Bench Press',
    sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }],
  }],
  totalVolume: 480, totalSets: 1, totalReps: 8,
};

const renderEdit = (onFinish = vi.fn()) => {
  render(<ActiveSession exercises={[]} editSession={past} onFinish={onFinish} onCancel={vi.fn()} />);
  return onFinish;
};

beforeEach(() => { localStorage.clear(); registerSession.mockClear(); });

describe('editing a past workout', () => {
  it('keeps the fields the edit screen has no control for', () => {
    const onFinish = renderEdit();

    fireEvent.click(screen.getByText('Save Changes'));

    const saved = onFinish.mock.calls[0][0] as WorkoutSession;
    // Used to come back as 'Home Gym', 1920 and undefined respectively.
    expect(saved.location).toBe('Commercial Gym');
    expect(saved.duration).toBe(1960);
    expect(saved.recoveryActivities).toEqual(past.recoveryActivities);
    expect(saved.isRestDay).toBe(false);
  });

  it('does not register itself as the live workout for the coach', () => {
    renderEdit();
    expect(registerSession).not.toHaveBeenCalled();
  });

  it('shows no rest bars — a record has no rest to start', () => {
    // The bars drove the live scheduler (sound, notification, toast) from
    // edit mode, where the no-op timer given to set completion never reached.
    const twoExercises: WorkoutSession = {
      ...past,
      exercises: [
        { ...past.exercises[0], sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }, { setNumber: 2, type: 'normal', reps: 8, weight: 60 }] },
        { exerciseId: 'incline-dumbbell-press', exerciseName: 'Incline Dumbbell Press', sets: [{ setNumber: 1, type: 'normal', reps: 10, weight: 20 }] },
      ],
    };
    const { unmount } = render(<ActiveSession exercises={[]} editSession={twoExercises} onFinish={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('Start Rest')).toBeNull();
    unmount();

    // The same layout in a live workout keeps its bars.
    render(<ActiveSession exercises={['flat-barbell-bench-press', 'incline-dumbbell-press']} onFinish={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByText('Start Rest').length).toBeGreaterThan(0);
  });

  it('leaves startedAt alone when neither the date nor the time was touched', () => {
    // The time field shows HH:mm; rebuilding startedAt from it on every edit
    // dropped the seconds and, worse, moved a workout that began before
    // midnight (startedAt on the 9th, date on the 10th) forward a day each
    // time it was opened and saved.
    const crossesMidnight: WorkoutSession = { ...past, startedAt: '2026-09-09T23:50:37.000Z' };
    const onFinish = vi.fn();
    render(<ActiveSession exercises={[]} editSession={crossesMidnight} onFinish={onFinish} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('Save Changes'));

    const saved = onFinish.mock.calls[0][0] as WorkoutSession;
    expect(saved.startedAt).toBe('2026-09-09T23:50:37.000Z');
    expect(saved.date).toBe('2026-09-10');
  });
});

describe('pausing a live workout', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-17T10:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('excludes the pause from the duration and keeps the true start', () => {
    const onFinish = vi.fn();
    // Mounted from a cache with one set already done, so Finish is allowed;
    // the cache predates trueStartTimestamp, so startTimestamp stands in.
    const t0 = Date.now();
    const cache: ActiveSessionCache = {
      workoutName: 'Push', startTimestamp: t0, elapsedAtCache: 0,
      blocks: [{
        exerciseId: 'flat-barbell-bench-press', exerciseName: 'Flat Barbell Bench Press', restSeconds: 90,
        sets: [{ setNumber: 1, weight: '60', reps: '8', completed: true, type: 'normal', rpe: '', time: '' }],
      }],
    };
    render(<ActiveSession exercises={[]} cachedSession={cache} onFinish={onFinish} onCancel={vi.fn()} />);

    act(() => { vi.advanceTimersByTime(60_000); });
    fireEvent.click(screen.getByTitle('Pause timer'));
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(screen.getByText('Finish'));

    const saved = onFinish.mock.calls[0][0] as WorkoutSession;
    expect(saved.duration).toBe(60);
    expect(saved.startedAt).toBe('2026-09-17T10:00:00.000Z');
  });
});
