import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('ExerciseTable weight-time rows', () => {
  const renderHold = (onUpdateSet = vi.fn()) => {
    const block = makeBlock({
      exerciseId: 'plank' as ExerciseBlock['exerciseId'],
      exerciseName: 'Plank',
      sets: [{ setNumber: 1, weight: '20', reps: '', rpe: '', time: '90', completed: false, type: 'normal' }],
    });
    render(
      <ExerciseTable
        {...baseProps}
        inputMode="weight-time"
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={onUpdateSet}
        onToggleComplete={vi.fn()}
      />,
    );
    return onUpdateSet;
  };

  it('renders a weight input and a time control, and no reps input', () => {
    renderHold();

    const weight = document.getElementById('input-0-0-weight') as HTMLInputElement;
    expect(weight).toBeTruthy();
    expect(weight.value).toBe('20');

    // The duration is entered through the time button, which shows m:ss.
    expect(screen.getByText('1:30')).toBeTruthy();
    expect(document.getElementById('input-0-0-reps')).toBeNull();
  });

  it('reports weight edits against the weight field', () => {
    const onUpdateSet = renderHold();
    const weight = document.getElementById('input-0-0-weight') as HTMLInputElement;
    fireEvent.change(weight, { target: { value: '25' } });
    expect(onUpdateSet).toHaveBeenCalledWith(0, 0, 'weight', '25');
  });

  it('completes an unweighted hold that only has a duration', () => {
    const block = makeBlock({
      exerciseId: 'plank' as ExerciseBlock['exerciseId'],
      exerciseName: 'Plank',
      sets: [{ setNumber: 1, weight: '', reps: '', rpe: '', time: '60', completed: false, type: 'normal' }],
    });
    const onToggleComplete = vi.fn();
    render(
      <ExerciseTable
        {...baseProps}
        inputMode="weight-time"
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={vi.fn()}
        onToggleComplete={onToggleComplete}
      />,
    );

    const checkBtn = screen.getByTestId('set-complete-0-0') as HTMLButtonElement;
    expect(checkBtn).not.toBeDisabled();
    fireEvent.click(checkBtn);
    expect(onToggleComplete).toHaveBeenCalledWith(0, 0);
  });
});

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

describe('ExerciseTable previous column', () => {
  const renderWithPrevious = (
    props: Partial<Parameters<typeof ExerciseTable>[0]> = {},
    onUpdateSet = vi.fn(),
  ) => {
    const block = makeBlock({
      sets: [
        { setNumber: 1, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' },
        { setNumber: 2, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' },
      ],
    });
    render(
      <ExerciseTable
        {...baseProps}
        block={block}
        blockIdx={0}
        blocks={[block]}
        onUpdateSet={onUpdateSet}
        onToggleComplete={vi.fn()}
        {...props}
      />,
    );
    return onUpdateSet;
  };

  it('shows the weight and reps logged for each set last time', () => {
    renderWithPrevious({
      previousSets: [
        { weight: 61.23, reps: 10 },
        { weight: 61.23, reps: 8 },
      ],
    });

    // 61.23 kg is what 135 lbs round-trips to in storage.
    expect(screen.getByText('135 × 10')).toBeInTheDocument();
    expect(screen.getByText('135 × 8')).toBeInTheDocument();
  });

  describe('naming the day those numbers came from', () => {
    // Pinned: the header reads relative to today, so a real clock would make
    // these assertions drift.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-19T12:00:00'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows the date alongside the column heading', () => {
      renderWithPrevious({ previousSets: [{ weight: 61.23, reps: 10 }], previousDate: '2026-08-11' });

      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Aug 11')).toBeInTheDocument();
    });

    it('says today and yesterday rather than a date', () => {
      renderWithPrevious({ previousSets: [{ weight: 61.23, reps: 10 }], previousDate: '2026-08-18' });
      expect(screen.getByText('yesterday')).toBeInTheDocument();
    });

    it('spells out the year for an older session', () => {
      renderWithPrevious({ previousSets: [{ weight: 61.23, reps: 10 }], previousDate: '2025-11-02' });
      expect(screen.getByText('Nov 2, 2025')).toBeInTheDocument();
    });

    it('shows no date when the exercise has never been logged', () => {
      renderWithPrevious({ previousSets: [] });
      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.queryByText(/^Aug /)).not.toBeInTheDocument();
    });
  });

  it('falls back to a dash for a set with nothing to compare against', () => {
    renderWithPrevious({ previousSets: [{ weight: 61.23, reps: 10 }] });

    expect(screen.getByText('135 × 10')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('keeps a half-kilo increment instead of rounding it away', () => {
    const onUpdateSet = renderWithPrevious(
      { previousSets: [{ weight: 62.5, reps: 5 }], weightUnit: 'kg' },
    );

    expect(screen.getByText('62.5 × 5')).toBeInTheDocument();

    // Tapping the cell copies exactly what it shows into the live set.
    fireEvent.click(screen.getByText('62.5 × 5'));
    expect(onUpdateSet).toHaveBeenCalledWith(0, 0, 'weight', '62.5');
    expect(onUpdateSet).toHaveBeenCalledWith(0, 0, 'reps', '5');
  });
});

describe('optional load on rep- and time-based rows', () => {
  const renderMode = (inputMode: 'reps' | 'time', set: Record<string, string>) => {
    const onUpdateSet = vi.fn();
    const block = makeBlock({
      exerciseId: 'custom-iso' as ExerciseBlock['exerciseId'],
      exerciseName: 'Calf Raise Iso',
      sets: [{ setNumber: 1, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal', ...set }],
    });
    // Rendered as the second block: the first row of the first block carries
    // the tutorial ids instead of the addressable input-<block>-<set>-<field>.
    render(
      <ExerciseTable
        {...baseProps}
        inputMode={inputMode}
        block={block}
        blockIdx={1}
        blocks={[block, block]}
        onUpdateSet={onUpdateSet}
        onToggleComplete={vi.fn()}
      />,
    );
    return onUpdateSet;
  };

  it('gives a timed hold a weight input alongside its duration', () => {
    const onUpdateSet = renderMode('time', { time: '45' });

    const weight = document.getElementById('input-1-0-weight') as HTMLInputElement;
    expect(weight).toBeTruthy();
    expect(screen.getByText('lbs')).toBeInTheDocument();

    fireEvent.change(weight, { target: { value: '35' } });
    expect(onUpdateSet).toHaveBeenCalledWith(1, 0, 'weight', '35');
  });

  it('gives a rep-only exercise a weight input alongside its reps', () => {
    const onUpdateSet = renderMode('reps', { reps: '15' });

    const weight = document.getElementById('input-1-0-weight') as HTMLInputElement;
    const reps = document.getElementById('input-1-0-reps') as HTMLInputElement;
    expect(weight).toBeTruthy();
    expect(reps).toBeTruthy();

    fireEvent.change(weight, { target: { value: '20' } });
    expect(onUpdateSet).toHaveBeenCalledWith(1, 0, 'weight', '20');
  });

  it('leaves the load blank rather than filling anything in', () => {
    renderMode('reps', { reps: '15' });
    const weight = document.getElementById('input-1-0-weight') as HTMLInputElement;
    expect(weight.value).toBe('');
    expect(weight.placeholder).toBe('—');
  });
});
