import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { addDays } from 'date-fns';
import { StartWorkoutScreen } from '@/components/StartWorkoutScreen';
import { formatLocalDate } from '@/utils/dateUtils';
import type { FutureWorkout, WorkoutProgram, WorkoutTemplate } from '@/types/workout';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const push: WorkoutTemplate = {
  id: 'tpl-push', name: 'Push Day',
  exercises: [{ exerciseId: 'flat-barbell-bench-press', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }],
};

const program: WorkoutProgram = {
  id: 'prog-active', name: 'Current', durationWeeks: 8,
  days: [{ label: 'Chest', templateId: push.id }],
};

const day = (offset: number) => formatLocalDate(addDays(new Date(), offset));

const row = (id: string, programId: string, date: string, over: Partial<FutureWorkout> = {}): FutureWorkout =>
  ({ id, programId, date, templateId: push.id, label: id, ...over });

describe("Start Workout's Future Workouts quick pick", () => {
  it("lists the current plan's upcoming rows, soonest first, not the oldest rows of every program", () => {
    const futureWorkouts: FutureWorkout[] = [
      row('missed-1', 'prog-active', day(-14)),
      row('missed-2', 'prog-active', day(-7)),
      row('old-program-1', 'prog-retired', day(-3)),
      row('old-program-2', 'prog-retired', day(1)),
      row('old-program-3', 'prog-retired', day(2)),
      row('old-program-4', 'prog-retired', day(3)),
      row('manual-soon', 'manual', day(4)),
      row('done', 'prog-active', day(5), { completed: true }),
      row('rest', 'prog-active', day(6), { templateId: 'rest' }),
      row('next-week', 'prog-active', day(8)),
      row('tomorrow', 'prog-active', day(1)),
    ];
    render(
      <StartWorkoutScreen
        templates={[push]} activeProgram={program} futureWorkouts={futureWorkouts}
        onBlankWorkout={vi.fn()} onSelectTemplate={vi.fn()} onStartProgramDay={vi.fn()} onBack={vi.fn()}
      />,
    );

    const section = screen.getByText('🗓️ Future Workouts').parentElement as HTMLElement;
    const labels = within(section).getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(labels).toEqual(['tomorrow', 'manual-soon', 'next-week']);
  });

  it('shows nothing when the current plan has nothing coming up', () => {
    render(
      <StartWorkoutScreen
        templates={[push]} activeProgram={program}
        futureWorkouts={[row('old-program', 'prog-retired', day(1)), row('missed', 'prog-active', day(-1))]}
        onBlankWorkout={vi.fn()} onSelectTemplate={vi.fn()} onStartProgramDay={vi.fn()} onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText('🗓️ Future Workouts')).toBeNull();
  });
});
