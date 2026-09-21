import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { format } from 'date-fns';
import { MonthlyCalendarScreen } from '@/components/MonthlyCalendarScreen';
import type { WorkoutSession } from '@/types/workout';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [{
      id: 'custom-ice-1', name: 'Ice Bath', primaryBodyPart: 'Full Body', equipment: 'None',
      difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Isometric',
      secondaryMuscles: [], isCustom: true, isRecovery: true,
    }],
    loading: false, addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const noop = () => {};

describe('MonthlyCalendarScreen — recovery activity names', () => {
  it('resolves them through the exercise lookup, like the activity screen', () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const restDay: WorkoutSession = {
      id: 'r1', date: today, exercises: [], duration: 0, totalVolume: 0, totalSets: 0, totalReps: 0,
      isRestDay: true,
      recoveryActivities: [
        { id: 'a1', activityId: 'swimming-full-body' },
        { id: 'a2', activityId: 'custom-ice-1' },
        { id: 'a3', activityId: 'cold-plunge' },
      ],
    };
    render(
      <MonthlyCalendarScreen
        history={[restDay]} templates={[]} futureWorkouts={[]} activeProgram={null}
        onBack={noop} onStartTemplate={noop} onOpenFutureWorkout={noop} onOpenSession={noop} onAddRestDay={noop}
      />,
    );

    expect(screen.getByText('Swimming, Ice Bath, Cold Plunge')).toBeInTheDocument();
  });
});
