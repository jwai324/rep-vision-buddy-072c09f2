import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FutureWorkout, WorkoutSession } from '@/types/workout';
import { getDailyStreak, getWeeklyStreak } from '@/utils/streak';
import { format } from 'date-fns';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/CustomExercisesContext', () => ({ useCustomExercisesContext: () => ({ exercises: [] }) }));
vi.mock('@/hooks/useExerciseLookup', () => ({ useExerciseLookup: () => ({}) }));

const { FutureWorkoutDetail } = await import('@/components/FutureWorkoutDetail');

const restDay = (over: Partial<FutureWorkout> = {}): FutureWorkout => ({
  id: 'fw-rest',
  programId: '11111111-2222-4333-8444-555555555555',
  date: '2026-09-20',
  templateId: 'rest',
  label: 'Rest Day',
  completed: false,
  ...over,
});

function renderRestDay(fw: FutureWorkout) {
  const onSaveRestDay = vi.fn();
  render(
    <FutureWorkoutDetail
      futureWorkout={fw}
      template={null}
      onPerformWorkout={vi.fn()}
      onSaveRestDay={onSaveRestDay}
      onBack={vi.fn()}
    />,
  );
  return onSaveRestDay;
}

// The Save button used to appear only once a recovery activity had been
// added, so marking a day as rest and leaving recorded nothing at all.
describe('saving a rest day with no recovery activities', () => {
  it('offers Save from the moment the screen opens', () => {
    const onSaveRestDay = renderRestDay(restDay());

    const button = screen.getByRole('button', { name: /Log Rest Day/ });
    fireEvent.click(button);

    expect(onSaveRestDay).toHaveBeenCalledTimes(1);
    expect(onSaveRestDay.mock.calls[0][0]).toMatchObject({ date: '2026-09-20', templateId: 'rest' });
  });

  it('still says Complete Rest Day once every activity is ticked', () => {
    renderRestDay(restDay({
      recoveryActivities: [{ id: 'a1', activityId: 'sauna', completed: true }],
    }));

    expect(screen.getByRole('button', { name: /Complete Rest Day/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Log Rest Day/ })).toBeNull();
  });

  it('says Save Rest Day while activities are still outstanding', () => {
    renderRestDay(restDay({
      recoveryActivities: [{ id: 'a1', activityId: 'sauna' }],
    }));

    expect(screen.getByRole('button', { name: /Save Rest Day/ })).toBeTruthy();
  });
});

// A plain rest day must be an ordinary rest day everywhere downstream, with
// no special case of its own — including in the streak.
describe('what an activity-free rest day counts for', () => {
  const day = (offset: number) => format(new Date(Date.now() + offset * 86_400_000), 'yyyy-MM-dd');

  const restSession = (date: string, activities?: WorkoutSession['recoveryActivities']): WorkoutSession => ({
    id: `rest-${date}`, date, exercises: [], duration: 0,
    totalVolume: 0, totalSets: 0, totalReps: 0,
    isRestDay: true, recoveryActivities: activities,
  });

  it('extends the daily streak exactly as one with activities does', () => {
    const withActivities = [
      restSession(day(0), [{ id: 'a1', activityId: 'sauna', completed: true }]),
      restSession(day(-1), [{ id: 'a2', activityId: 'yoga', completed: true }]),
    ];
    const bare = [restSession(day(0)), restSession(day(-1))];

    expect(getDailyStreak(bare)).toBe(2);
    expect(getDailyStreak(bare)).toBe(getDailyStreak(withActivities));
  });

  it('counts for nothing in the weekly streak, which is workouts only', () => {
    expect(getWeeklyStreak([restSession(day(0)), restSession(day(-1))], 1)).toBe(0);
  });
});
