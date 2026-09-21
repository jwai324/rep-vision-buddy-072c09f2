import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateExerciseForm } from '@/components/CreateExerciseForm';
import type { CustomExercise } from '@/hooks/useCustomExercises';

const customExercise = (overrides: Partial<CustomExercise> = {}): CustomExercise => ({
  id: 'custom-1',
  name: 'Band Pull Apart X',
  primaryBodyPart: 'Back',
  equipment: 'Band',
  difficulty: 'Beginner',
  exerciseType: 'Isolation',
  movementPattern: 'Other',
  secondaryMuscles: [],
  isCustom: true,
  isRecovery: false,
  excludeFromVolume: false,
  ...overrides,
});

describe('CreateExerciseForm required fields', () => {
  it('disables Save until name, body part, equipment, and difficulty are all chosen', () => {
    render(<CreateExerciseForm onSave={vi.fn()} onCancel={vi.fn()} />);

    const saveBtn = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();

    // Type a name
    const nameInput = screen.getByPlaceholderText(/Bulgarian Split Squat/i);
    fireEvent.change(nameInput, { target: { value: 'Test Exercise' } });
    expect(saveBtn).toBeDisabled();

    // Pick body part (any chip in the body part section)
    fireEvent.click(screen.getByRole('button', { name: 'Chest' }));
    expect(saveBtn).toBeDisabled();

    // Pick equipment
    fireEvent.click(screen.getByRole('button', { name: 'Barbell' }));
    expect(saveBtn).toBeDisabled();

    // Pick difficulty → now Save should be enabled
    fireEvent.click(screen.getByRole('button', { name: 'Intermediate' }));
    expect(saveBtn).not.toBeDisabled();
  });

  it('shows required-field "Select…" hints when no value is chosen', () => {
    render(<CreateExerciseForm onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/select a body part/i)).toBeInTheDocument();
    expect(screen.getByText(/select equipment/i)).toBeInTheDocument();
    expect(screen.getByText(/select difficulty/i)).toBeInTheDocument();
  });

  it('shows inline duplicate error when name matches an existing exercise', () => {
    render(<CreateExerciseForm onSave={vi.fn()} onCancel={vi.fn()} />);

    const nameInput = screen.getByPlaceholderText(/Bulgarian Split Squat/i);
    // "Flat Barbell Bench Press" is in EXERCISE_DATABASE; try a case-insensitive trim too
    fireEvent.change(nameInput, { target: { value: '  flat barbell bench press  ' } });

    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    const saveBtn = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();
  });

  it('calls onSave with the filled values when Save is clicked', () => {
    const onSave = vi.fn();
    render(<CreateExerciseForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Bulgarian Split Squat/i), {
      target: { value: 'Unique Test Lift' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Barbell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Intermediate' }));

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Unique Test Lift',
      primaryBodyPart: 'Chest',
      equipment: 'Barbell',
      difficulty: 'Intermediate',
    });
  });
});

describe('CreateExerciseForm measurement type honesty', () => {
  it('does not offer measurement chips for Band equipment and explains why', () => {
    render(<CreateExerciseForm onSave={vi.fn()} onCancel={vi.fn()} />);

    // Before Band is chosen the chips are offered.
    expect(screen.getByRole('button', { name: 'Reps + Weight' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Band' }));

    for (const mt of ['Reps', 'Reps + Weight', 'Time', 'Distance', 'Time + Distance', 'Time + Weight']) {
      expect(screen.queryByRole('button', { name: mt })).toBeNull();
    }
    expect(screen.getByText(/always logged as a band level and reps/i)).toBeInTheDocument();
    expect(screen.queryByText(/leave blank for/i)).toBeNull();
  });

  it('saves no measurement type when a pick is followed by switching to Band', () => {
    const onSave = vi.fn();
    render(<CreateExerciseForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Bulgarian Split Squat/i), {
      target: { value: 'Unique Band Move' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Beginner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));

    fireEvent.click(screen.getByRole('button', { name: 'Band' }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].measurementType).toBeNull();
  });

  it('says the blank default is Time for Cardio and Reps + Weight elsewhere', () => {
    render(<CreateExerciseForm onSave={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chest' }));
    expect(screen.getByText(/leave blank for Reps \+ Weight \(default\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/choosing explicitly is recommended/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cardio' }));
    expect(screen.getByText(/leave blank for Time \(default\)/i)).toBeInTheDocument();
    // Blank on Cardio also makes the app log a warning, so nudge (not force).
    expect(screen.getByText(/choosing explicitly is recommended/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Time + Distance' }));
    expect(screen.queryByText(/choosing explicitly is recommended/i)).toBeNull();
  });

  it('applies both rules when editing an existing exercise', () => {
    const onSave = vi.fn();
    const { unmount } = render(
      <CreateExerciseForm
        onSave={onSave}
        onCancel={vi.fn()}
        editingExercise={customExercise({ equipment: 'Band', measurementType: 'Time' })}
      />
    );

    expect(screen.queryByRole('button', { name: 'Reps + Weight' })).toBeNull();
    expect(screen.getByText(/always logged as a band level and reps/i)).toBeInTheDocument();

    // The stale stored type is cleared, so the row matches what the form says.
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }));
    expect(onSave.mock.calls[0][0].measurementType).toBeNull();

    unmount();

    render(
      <CreateExerciseForm
        onSave={vi.fn()}
        onCancel={vi.fn()}
        editingExercise={customExercise({ name: 'Custom Jog', primaryBodyPart: 'Cardio', equipment: 'None' })}
      />
    );
    expect(screen.getByText(/leave blank for Time \(default\)/i)).toBeInTheDocument();
  });
});
