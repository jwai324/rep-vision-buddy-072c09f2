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
