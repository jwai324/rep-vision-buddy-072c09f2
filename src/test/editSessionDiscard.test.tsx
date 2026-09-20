import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import type { WorkoutSession } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
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

const past: WorkoutSession = {
  id: 'sess-1',
  date: '2026-09-10',
  startedAt: '2026-09-10T18:05:00.000Z',
  duration: 1960,
  location: 'Commercial Gym',
  exercises: [{
    exerciseId: 'flat-barbell-bench-press',
    exerciseName: 'Flat Barbell Bench Press',
    sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }],
  }],
  totalVolume: 480, totalSets: 1, totalReps: 8,
};

const renderEdit = (session: WorkoutSession = past) => {
  const onCancel = vi.fn();
  render(<ActiveSession exercises={[]} editSession={session} onFinish={vi.fn()} onCancel={onCancel} />);
  return onCancel;
};

beforeEach(() => localStorage.clear());

describe('leaving an edit of a past workout', () => {
  it('closes on one tap when nothing was changed', () => {
    const onCancel = renderEdit();

    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard changes?')).toBeNull();
  });

  it('reads the repairs made on the way in as no change at all', () => {
    // A set number whose first row was saved as a 'dropset' is coerced back to
    // a real parent when the session is read into the editor. That is the
    // screen normalising, not the user editing, and must not turn closing an
    // untouched record into a two-tap job.
    const legacy: WorkoutSession = {
      ...past,
      exercises: [{ ...past.exercises[0], sets: [{ setNumber: 1, type: 'dropset', reps: 8, weight: 60 }] }],
    };
    const onCancel = renderEdit(legacy);

    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing an edit away, and keeps the screen until told', () => {
    const onCancel = renderEdit();
    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '65' } });

    fireEvent.click(screen.getByLabelText('Cancel editing'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();

    fireEvent.click(screen.getByText('Keep editing'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('65')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Cancel editing'));
    fireEvent.click(screen.getByText('Discard'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('asks about the date, time, duration and note fields too', () => {
    const onCancel = renderEdit();
    // 1960s shows as 32 minutes; retyping it is a real edit of the record.
    fireEvent.change(screen.getByDisplayValue('32'), { target: { value: '35' } });

    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();
  });
});
