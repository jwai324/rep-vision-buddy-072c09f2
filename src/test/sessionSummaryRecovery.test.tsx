import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SessionSummary } from '@/components/SessionSummary';
import type { WorkoutSession } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const CUSTOM = 'custom-11111111-2222-3333-4444-555555555555';
vi.mock('@/contexts/CustomExercisesContext', () => {
  const exercises = [{
    id: 'custom-11111111-2222-3333-4444-555555555555', name: 'Contrast Shower', primaryBodyPart: 'Full Body',
    equipment: 'None', difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Recovery',
    secondaryMuscles: [], measurementType: 'Time', isCustom: true, isRecovery: true, excludeFromVolume: true,
  }];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const restDay: WorkoutSession = {
  id: 's1',
  date: '2026-09-10',
  duration: 0, totalVolume: 0, totalSets: 0, totalReps: 0,
  exercises: [],
  isRestDay: true,
  recoveryActivities: [
    { id: 'a-built-in', activityId: 'sauna' },
    { id: 'a-custom', activityId: CUSTOM },
    { id: 'a-gone', activityId: 'custom-deleted' },
  ],
};

describe('a rest day with a custom recovery activity', () => {
  it('lists it by name next to the built-in ones and keeps a row it cannot resolve', () => {
    render(<SessionSummary session={restDay} isViewMode onUpdateSession={vi.fn()} />);

    const plan = screen.getByText('Recovery Plan').parentElement as HTMLElement;
    expect(within(plan).getByText('Sauna')).toBeInTheDocument();
    const custom = within(plan).getByText('Contrast Shower').parentElement as HTMLElement;
    expect(within(custom).getByText('None · Full Body')).toBeInTheDocument();
    // Dropping the row was how an activity could neither be ticked nor removed.
    expect(within(plan).getByText('custom-deleted')).toBeInTheDocument();
  });

  it('can tick it off and remove it', () => {
    const onUpdateSession = vi.fn();
    render(<SessionSummary session={restDay} isViewMode onUpdateSession={onUpdateSession} />);

    const rowOf = (name: string) => screen.getByText(name).closest('.flex.items-center.gap-3') as HTMLElement;
    const [tick, remove] = within(rowOf('Contrast Shower')).getAllByRole('button');

    fireEvent.click(tick);
    expect(onUpdateSession).toHaveBeenLastCalledWith(expect.objectContaining({
      recoveryActivities: expect.arrayContaining([expect.objectContaining({ id: 'a-custom', completed: true })]),
    }));

    fireEvent.click(remove);
    const after = onUpdateSession.mock.calls.at(-1)?.[0] as WorkoutSession;
    expect(after.recoveryActivities?.map(a => a.id)).toEqual(['a-built-in', 'a-gone']);
  });
});
