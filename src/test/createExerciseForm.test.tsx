import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateExerciseForm } from '@/components/CreateExerciseForm';

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
