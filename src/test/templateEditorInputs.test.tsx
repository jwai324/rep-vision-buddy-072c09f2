import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import type { WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/CustomExercisesContext', () => {
  const exercises: never[] = [];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});
// The real picker is a full library browser; the swap path only needs a way
// to hand an id back, including one that is already in the template.
vi.mock('@/components/ExerciseSelector', () => ({
  ExerciseSelector: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <div>
      <button onClick={() => onSelect('dumbbell-fly')}>pick fly</button>
      <button onClick={() => onSelect('barbell-bent-over-row')}>pick row</button>
    </div>
  ),
}));

const BENCH = 'flat-barbell-bench-press';
const FLY = 'dumbbell-fly';
const ROW = 'barbell-bent-over-row';

const template: WorkoutTemplate = {
  id: 'tpl-1',
  name: 'Push',
  exercises: [
    { exerciseId: BENCH, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
    { exerciseId: FLY, sets: 3, targetReps: 12, setType: 'normal', restSeconds: 60 },
  ],
};

const saveAndRead = (onSave: ReturnType<typeof vi.fn>) => {
  fireEvent.click(screen.getByText('Save Template'));
  return (onSave.mock.calls[0][0] as WorkoutTemplate).exercises;
};

const browseToSwap = (exerciseName: string) => {
  fireEvent.click(screen.getByLabelText(`Options for ${exerciseName}`));
  fireEvent.click(screen.getByText('Replace Exercise'));
  fireEvent.click(screen.getByText('Browse All Exercises'));
};

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('replacing a template exercise', () => {
  it('refuses an exercise the template already holds and leaves the list as it was', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template} onSave={onSave} onCancel={vi.fn()} />);

    browseToSwap('Flat Barbell Bench Press');
    fireEvent.click(screen.getByText('pick fly'));

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Dumbbell Fly is already in this template/));
    expect(saveAndRead(onSave).map(e => e.exerciseId)).toEqual([BENCH, FLY]);
  });

  it('still swaps in an exercise that is not in the template', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template} onSave={onSave} onCancel={vi.fn()} />);

    browseToSwap('Flat Barbell Bench Press');
    fireEvent.click(screen.getByText('pick row'));

    expect(toast.error).not.toHaveBeenCalled();
    expect(saveAndRead(onSave).map(e => e.exerciseId)).toEqual([ROW, FLY]);
  });
});

describe('rest seconds', () => {
  it('clamps a negative rest to 0', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template} onSave={onSave} onCancel={vi.fn()} />);

    const [rest] = screen.getAllByDisplayValue('90');
    fireEvent.change(rest, { target: { value: '-30' } });

    expect(saveAndRead(onSave)[0].restSeconds).toBe(0);
  });
});
