import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SharedTemplateView } from '@/components/shared/SharedTemplateView';
import type { TemplateExercise, WorkoutTemplate } from '@/types/workout';

const ex = (over: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId: 'flat-barbell-bench-press',
  sets: 3,
  targetReps: 10,
  setType: 'normal',
  restSeconds: 90,
  ...over,
});

const meta = [
  { exerciseId: 'flat-barbell-bench-press', name: 'Bench Press', icon: '🏋️' },
  { exerciseId: 'barbell-bent-over-row', name: 'Bent-Over Row', icon: '🏋️' },
  { exerciseId: 'lat-pulldown', name: 'Lat Pulldown', icon: '🏋️' },
];

function view(exercises: TemplateExercise[]) {
  const template: WorkoutTemplate = { id: 'tpl-upper', name: 'Upper', exercises };
  return render(
    <SharedTemplateView template={template} exerciseMeta={meta} customExercises={[]} unit="kg" />,
  );
}

const badges = () => screen.queryAllByTestId('superset-badge').map(b => b.textContent);

describe('SharedTemplateView — supersets', () => {
  it('names a superset by its pairing and position, never by the stored group id', () => {
    view([
      ex({ setType: 'superset', supersetGroup: 7 }),
      ex({ exerciseId: 'barbell-bent-over-row', setType: 'superset', supersetGroup: 7 }),
      ex({ exerciseId: 'lat-pulldown' }),
    ]);
    expect(badges()).toEqual(['Superset A · 1 of 2', 'Superset A · 2 of 2']);
    expect(screen.queryByText(/Superset 7/)).toBeNull();
  });

  it('links an older setType-only superset the way the app does', () => {
    view([
      ex({ setType: 'superset' }),
      ex({ exerciseId: 'barbell-bent-over-row', setType: 'superset' }),
    ]);
    expect(badges()).toEqual(['Superset A · 1 of 2', 'Superset A · 2 of 2']);
  });

  it('shows nothing for a lone superset-typed exercise, which links to nothing', () => {
    view([ex(), ex({ exerciseId: 'barbell-bent-over-row', setType: 'superset' })]);
    expect(badges()).toEqual([]);
    expect(screen.getByText('2 exercises · 6 sets')).toBeTruthy();
  });
});

describe('SharedTemplateView — distance target', () => {
  // The definition travels with the snapshot; without it the exercise would
  // read as reps-and-weight and the target would not be shown at all.
  const run = {
    sourceId: 'custom-run', name: 'Trail Run', primaryBodyPart: 'Cardio', equipment: 'None',
    difficulty: 'Beginner' as const, exerciseType: 'Compound' as const, movementPattern: 'Lunge',
    secondaryMuscles: [], isRecovery: false, measurementType: 'Distance' as const,
  };
  const runMeta = [{ exerciseId: 'custom-run', name: 'Trail Run', icon: '🏃' }];
  const runTemplate = (over: Partial<TemplateExercise> = {}): WorkoutTemplate => ({
    id: 'tpl-run', name: 'Run',
    exercises: [ex({ exerciseId: 'custom-run', sets: 1, targetReps: 'failure', ...over })],
  });

  it.each([['kg', '@ 5 km'], ['lbs', '@ 3.11 mi']] as const)('shows the target in the %s viewer\'s unit, without trailing zeros', (unit, shown) => {
    render(<SharedTemplateView template={runTemplate({ targetDistance: 5000 })} exerciseMeta={runMeta} customExercises={[run]} unit={unit} />);
    expect(screen.getByText(shown)).toBeTruthy();
  });

  it('shows the target on built-in time-and-distance work, which is what a run or a row is', () => {
    const rowing: WorkoutTemplate = {
      id: 'tpl-row', name: 'Row',
      exercises: [ex({ exerciseId: 'rowing-machine', sets: 1, targetReps: 20, targetDistance: 5000 })],
    };
    const rowingMeta = [{ exerciseId: 'rowing-machine', name: 'Rowing Machine', icon: '🚣' }];
    render(<SharedTemplateView template={rowing} exerciseMeta={rowingMeta} customExercises={[]} unit="kg" />);
    expect(screen.getByText('@ 5 km')).toBeTruthy();
  });

  it('shows no target for a payload frozen before the field existed', () => {
    render(<SharedTemplateView template={runTemplate()} exerciseMeta={runMeta} customExercises={[run]} unit="kg" />);
    expect(screen.queryByText(/^@ /)).toBeNull();
  });
});
