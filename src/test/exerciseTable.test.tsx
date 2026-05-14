import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseTable } from '@/components/ExerciseTableComponent';
import type { ExerciseBlock } from '@/types/activeSession';

function makeBlock(overrides: Partial<ExerciseBlock> = {}): ExerciseBlock {
  return {
    exerciseId: 'bench-press' as ExerciseBlock['exerciseId'],
    exerciseName: 'Bench Press',
    restSeconds: 90,
    sets: [
      {
        setNumber: 1,
        weight: '135',
        reps: '10',
        rpe: '',
        time: '',
        completed: false,
        type: 'normal',
      },
    ],
    ...overrides,
  };
}

const baseProps = {
  weightUnit: 'lbs' as const,
  distanceUnit: 'mi' as const,
  stickyNote: '',
  activeTimer: null,
  restRecords: {},
  previousSets: [],
  inputMode: 'reps-weight' as const,
  onAddSet: vi.fn(),
  onAddDrop: vi.fn(),
  onUpdateDrop: vi.fn(),
  onRemoveSet: vi.fn(),
  onRemoveDrop: vi.fn(),
  onMenuAction: vi.fn(),
  onStartTimer: vi.fn(),
  onSkipTimer: vi.fn(),
  onExtendTimer: vi.fn(),
};

describe('ExerciseTable inline validation', () => {
  it('shows weight error and disables checkmark for -250 lbs', () => {
    const block = makeBlock({
      sets: [{ setNumber: 1, weight: '-250', reps: '10', rpe: '', time: '', completed: false, type: 'normal' }],
    });
    const onToggleComplete = vi.fn();

    render(
      <ExerciseTable
        {...baseProps}
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={vi.fn()}
        onToggleComplete={onToggleComplete}
      />,
    );

    // Inline error text is rendered
    const weightError = screen.getByTestId('weight-error');
    expect(weightError.textContent).toMatch(/0.*2000.*lbs/);

    // Checkmark is disabled
    const checkBtn = screen.getByTestId('set-complete-0-0') as HTMLButtonElement;
    expect(checkBtn).toBeDisabled();
    expect(checkBtn.className).toMatch(/pointer-events-none/);

    // Clicking does not toggle complete
    fireEvent.click(checkBtn);
    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it('shows reps error and disables checkmark for 99999 reps', () => {
    const block = makeBlock({
      sets: [{ setNumber: 1, weight: '135', reps: '99999', rpe: '', time: '', completed: false, type: 'normal' }],
    });
    const onToggleComplete = vi.fn();

    render(
      <ExerciseTable
        {...baseProps}
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={vi.fn()}
        onToggleComplete={onToggleComplete}
      />,
    );

    const repsError = screen.getByTestId('reps-error');
    expect(repsError.textContent).toMatch(/0.*200/);

    const checkBtn = screen.getByTestId('set-complete-0-0') as HTMLButtonElement;
    expect(checkBtn).toBeDisabled();
    fireEvent.click(checkBtn);
    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it('shows no error and enables checkmark for valid values', () => {
    const block = makeBlock({
      sets: [{ setNumber: 1, weight: '135', reps: '10', rpe: '8', time: '', completed: false, type: 'normal' }],
    });
    const onToggleComplete = vi.fn();

    render(
      <ExerciseTable
        {...baseProps}
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={vi.fn()}
        onToggleComplete={onToggleComplete}
      />,
    );

    expect(screen.queryByTestId('set-errors-0-0')).toBeNull();

    const checkBtn = screen.getByTestId('set-complete-0-0') as HTMLButtonElement;
    expect(checkBtn).not.toBeDisabled();
    fireEvent.click(checkBtn);
    expect(onToggleComplete).toHaveBeenCalledWith(0, 0);
  });

  it('shows no inline error while a field is empty', () => {
    const block = makeBlock({
      sets: [{ setNumber: 1, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' }],
    });

    render(
      <ExerciseTable
        {...baseProps}
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={vi.fn()}
        onToggleComplete={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('set-errors-0-0')).toBeNull();
  });

  it('applies red ring class to invalid weight input', () => {
    const block = makeBlock({
      sets: [{ setNumber: 1, weight: '-250', reps: '10', rpe: '', time: '', completed: false, type: 'normal' }],
    });

    render(
      <ExerciseTable
        {...baseProps}
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={vi.fn()}
        onToggleComplete={vi.fn()}
      />,
    );

    const weightInput = document.getElementById('tutorial-weight-input') as HTMLInputElement;
    expect(weightInput).toBeTruthy();
    expect(weightInput.className).toMatch(/ring-destructive/);
    expect(weightInput.getAttribute('aria-invalid')).toBe('true');
  });
});
