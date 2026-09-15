import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgramView } from '@/components/ProgramView';
import type { CustomExerciseLite } from '@/utils/shareSnapshot';
import type { WorkoutProgram, WorkoutTemplate } from '@/types/workout';

const CUSTOM_ID = 'custom-11111111-2222-3333-4444-555555555555';

const plank: CustomExerciseLite = {
  id: CUSTOM_ID,
  name: 'Weighted Plank',
  primaryBodyPart: 'Core',
  equipment: 'Bodyweight',
  difficulty: 'Intermediate',
  exerciseType: 'Compound',
  movementPattern: 'Core',
  secondaryMuscles: [],
  measurementType: 'Time',
  isCustom: true,
  isRecovery: false,
};

const push: WorkoutTemplate = {
  id: 'tpl-push',
  name: 'Push Day',
  exercises: [
    { exerciseId: 'flat-barbell-bench-press', sets: 4, targetReps: 8, setType: 'normal', restSeconds: 120 },
    { exerciseId: CUSTOM_ID, sets: 3, targetReps: 30, setType: 'normal', restSeconds: 60 },
  ],
};

const pull: WorkoutTemplate = {
  id: 'tpl-pull',
  name: 'Pull Day',
  exercises: [
    { exerciseId: 'barbell-bent-over-row', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
  ],
};

const program: WorkoutProgram = {
  id: 'prog-1',
  name: 'Push/Pull',
  days: [
    { label: 'Chest & triceps', templateId: 'tpl-push' },
    { label: 'Back & biceps', templateId: 'tpl-pull' },
    { label: 'Rest', templateId: 'rest' },
  ],
};

function renderView(over: Partial<React.ComponentProps<typeof ProgramView>> = {}) {
  return render(
    <ProgramView
      program={program}
      templates={[push, pull]}
      customExercises={[plank]}
      weightUnit="kg"
      onBack={vi.fn()}
      {...over}
    />,
  );
}

describe('ProgramView', () => {
  it('lists every day collapsed, with the program name shown once', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Push/Pull' })).toBeInTheDocument();
    expect(screen.getAllByText('Push/Pull')).toHaveLength(1);
    expect(screen.getByText('Day 1: Push Day')).toBeInTheDocument();
    expect(screen.getByText('Day 2: Pull Day')).toBeInTheDocument();
    expect(screen.getByText('Day 3: Rest')).toBeInTheDocument();
    expect(screen.getByText('3 days — 2 training, 1 rest')).toBeInTheDocument();
    expect(screen.queryByText('Flat Barbell Bench Press')).toBeNull();
  });

  it('expands a day to its exercises and collapses the previously open one', () => {
    renderView();

    fireEvent.click(screen.getByText('Day 1: Push Day'));
    expect(screen.getByText('Flat Barbell Bench Press')).toBeInTheDocument();
    // Custom exercises are resolved through the library, not the stored id.
    expect(screen.getByText('Weighted Plank')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Day 2: Pull Day'));
    expect(screen.getByText('Barbell Bent-Over Row')).toBeInTheDocument();
    expect(screen.queryByText('Flat Barbell Bench Press')).toBeNull();
  });

  it('shows a day labelled after its template only once', () => {
    renderView();

    // Day 3 is labelled "Rest" and is a rest day.
    expect(screen.getAllByText(/Rest/)).toHaveLength(1);
    // Days labelled differently keep their label as the subtitle.
    expect(screen.getByText('Chest & triceps')).toBeInTheDocument();
  });

  it('leaves a rest day unexpandable', () => {
    renderView();

    const restDay = screen.getByText('Day 3: Rest').closest('button');
    expect(restDay).toBeDisabled();
  });

  it('keeps the day readable when its template has been deleted', () => {
    renderView({ templates: [pull] });

    expect(screen.getByText('Day 1: Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Day 2: Pull Day')).toBeInTheDocument();
  });

  it('says so rather than crashing when the program itself is gone', () => {
    renderView({ program: undefined });

    expect(screen.getByText('This program is no longer available.')).toBeInTheDocument();
  });
});
