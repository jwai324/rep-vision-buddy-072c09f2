import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import { useBlockMutations } from '@/hooks/useBlockMutations';
import { ActiveSession } from '@/components/ActiveSession';
import type { ExerciseBlock, DropRow, SetRow } from '@/types/activeSession';
import type { WorkoutSession } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => {
  const exercises: never[] = [];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const BENCH = 'flat-barbell-bench-press';
// A built-in 'Time + Weight' exercise, so its rows are time-led.
const PLANK = 'plank';

const drop = (over: Partial<DropRow> = {}): DropRow => ({ weight: '', reps: '', rpe: '', completed: false, ...over });

function harness(exerciseId: string, drops: DropRow[]) {
  const parent: SetRow = { setNumber: 1, weight: '135', reps: '10', rpe: '', time: '', completed: true, type: 'normal', drops };
  let blocks: ExerciseBlock[] = [{
    exerciseId: exerciseId as ExerciseBlock['exerciseId'],
    exerciseName: 'Bench Press',
    restSeconds: 90,
    dropSetsEnabled: true,
    sets: [parent],
  }];
  const setBlocks = (updater: React.SetStateAction<ExerciseBlock[]>) => {
    blocks = typeof updater === 'function' ? updater(blocks) : updater;
  };
  const { result } = renderHook(() =>
    useBlockMutations(blocks, setBlocks, {
      weightUnit: 'lbs', defaultDropSetsEnabled: true, defaultRestSeconds: 90,
      customExercises: [], startTimer: vi.fn(),
    }),
  );
  return { result, drops: () => blocks[0].sets[0].drops! };
}

describe('ticking a drop obeys the main row\'s completion rules', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a drop with blank reps on a reps-weight exercise and leaves it unticked', () => {
    const { result, drops } = harness(BENCH, [drop({ weight: '100' })]);

    act(() => { result.current.updateDrop(0, 0, 0, 'completed', true); });

    expect(toast.error).toHaveBeenCalledWith('Enter valid weight and reps before completing this set.');
    expect(drops()[0].completed).toBe(false);
  });

  it('completes a drop that has a valid weight and reps', () => {
    const { result, drops } = harness(BENCH, [drop({ weight: '100', reps: '8' })]);

    act(() => { result.current.updateDrop(0, 0, 0, 'completed', true); });

    expect(toast.error).not.toHaveBeenCalled();
    expect(drops()[0].completed).toBe(true);
  });

  it('needs a time on a time-based exercise, and completes once it has one', () => {
    const { result, drops } = harness(PLANK, [drop({ weight: '20' })]);

    act(() => { result.current.updateDrop(0, 0, 0, 'completed', true); });
    expect(toast.error).toHaveBeenCalledWith('Enter a time before completing this set.');
    expect(drops()[0].completed).toBe(false);

    act(() => { result.current.updateDrop(0, 0, 0, 'time', '30'); });
    act(() => { result.current.updateDrop(0, 0, 0, 'completed', true); });
    expect(drops()[0].completed).toBe(true);
  });

  it('never stands in the way of unticking or of editing a field', () => {
    const { result, drops } = harness(BENCH, [drop({ weight: '100', completed: true })]);

    act(() => { result.current.updateDrop(0, 0, 0, 'completed', false); });
    act(() => { result.current.updateDrop(0, 0, 0, 'reps', '6'); });

    expect(toast.error).not.toHaveBeenCalled();
    expect(drops()[0]).toMatchObject({ completed: false, reps: '6' });
  });
});

describe('Finish checks the drops that reach the log', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  const input = (id: string) => document.getElementById(id) as HTMLInputElement;

  const logOneSetWithADrop = () => {
    fireEvent.change(input('tutorial-weight-input'), { target: { value: '135' } });
    fireEvent.change(input('tutorial-reps-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('set-complete-0-0'));

    fireEvent.click(screen.getAllByText('+ Add Dropset')[0]);
    fireEvent.change(input('input-0-0-d0-weight'), { target: { value: '100' } });
    fireEvent.change(input('input-0-0-d0-reps'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('drop-complete-0-0-0'));
  };

  it('is refused while a completed drop holds an invalid weight, and saves the drop once it is fixed', () => {
    const onFinish = vi.fn();
    render(<ActiveSession exercises={[BENCH]} weightUnit="lbs" defaultDropSetsEnabled onFinish={onFinish} onCancel={vi.fn()} />);
    logOneSetWithADrop();

    // The value went bad after the tick, which is the only way a completed row
    // gets an invalid field — the tick itself is refused for one.
    fireEvent.change(input('input-0-0-d0-weight'), { target: { value: '-250' } });
    fireEvent.click(screen.getByText('Finish'));

    expect(toast.error).toHaveBeenCalledWith('Fix invalid weight in Flat Barbell Bench Press, Set 1 drop 1');
    expect(onFinish).not.toHaveBeenCalled();

    fireEvent.change(input('input-0-0-d0-weight'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Finish'));
    if (screen.queryByText('Save short workout?')) fireEvent.click(screen.getByText('Save'));

    expect(onFinish).toHaveBeenCalledTimes(1);
    const session = onFinish.mock.calls[0][0] as WorkoutSession;
    expect(session.exercises[0].sets.map(s => s.type)).toEqual(['normal', 'dropset']);
    expect(session.exercises[0].sets[1]).toMatchObject({ reps: 8 });
  });
});
