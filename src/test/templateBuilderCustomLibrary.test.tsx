import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import type { WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const BAND = 'custom-band-row';
const library = vi.hoisted(() => ({
  exercises: [] as { id: string; name: string; primaryBodyPart: string; equipment: string; measurementType?: string | null }[],
  loading: true,
}));
vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: library.exercises, loading: library.loading,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const bandRow = {
  id: BAND, name: 'Band Row', primaryBodyPart: 'Back', equipment: 'Band',
  difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Horizontal Pull',
  secondaryMuscles: [], measurementType: 'Reps + Weight', isRecovery: false, excludeFromVolume: false,
};

const template: WorkoutTemplate = {
  id: 'tpl-1',
  name: 'Back',
  exercises: [{ exerciseId: BAND, sets: 3, targetReps: 12, setType: 'normal', restSeconds: 60, targetWeight: 4 }],
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  library.exercises = [];
  library.loading = true;
});

describe('editing a template before the custom library has loaded', () => {
  it('waits for the library, then reads a band level as a level and saves it back unchanged', () => {
    const onSave = vi.fn();
    const { rerender } = render(<TemplateBuilder initial={template} weightUnit="lbs" onSave={onSave} onCancel={vi.fn()} />);

    // Mounting now would derive the blocks with the band exercise read as
    // reps-and-weight, turning level 4 into "8.8 lbs".
    expect(screen.queryByText('Save Template')).toBeNull();

    library.exercises = [bandRow];
    library.loading = false;
    rerender(<TemplateBuilder initial={template} weightUnit="lbs" onSave={onSave} onCancel={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveValue('4');
    fireEvent.click(screen.getByText('Save Template'));
    expect((onSave.mock.calls[0][0] as WorkoutTemplate).exercises[0].targetWeight).toBe(4);
  });

  it('does not hold up a new template, which has nothing to derive', () => {
    render(<TemplateBuilder onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Save Template')).toBeInTheDocument();
  });
});
