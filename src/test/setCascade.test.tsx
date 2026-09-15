import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlockMutations } from '@/hooks/useBlockMutations';
import type { ExerciseBlock, SetRow } from '@/types/activeSession';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const set = (n: number, over: Partial<SetRow> = {}): SetRow => ({
  setNumber: n, weight: '135', reps: '10', rpe: '', time: '',
  completed: false, type: 'normal', ...over,
});

function harness(sets: SetRow[]) {
  let blocks: ExerciseBlock[] = [{
    exerciseId: 'flat-barbell-bench-press' as ExerciseBlock['exerciseId'],
    exerciseName: 'Bench Press',
    restSeconds: 90,
    sets,
  }];
  const setBlocks = (updater: React.SetStateAction<ExerciseBlock[]>) => {
    blocks = typeof updater === 'function' ? updater(blocks) : updater;
  };
  const { result } = renderHook(() =>
    useBlockMutations(blocks, setBlocks, {
      weightUnit: 'lbs', defaultDropSetsEnabled: false, defaultRestSeconds: 90,
      customExercises: [], startTimer: vi.fn(),
    }),
  );
  return { result, weights: () => blocks[0].sets.map(s => s.weight) };
}

describe('editing one set cascades only into sets not yet performed', () => {
  it('leaves sets already ticked off alone', () => {
    // The lifter logged three sets at 135, then noticed set 1 was really 145.
    // Correcting it used to rewrite sets 2 and 3 — history the app invented.
    const { result, weights } = harness([
      set(1, { completed: true }), set(2, { completed: true }), set(3, { completed: true }),
    ]);

    act(() => { result.current.updateSet(0, 0, 'weight', '145'); });

    expect(weights()).toEqual(['145', '135', '135']);
  });

  it('still fills forward into sets not yet performed', () => {
    const { result, weights } = harness([set(1), set(2), set(3)]);

    act(() => { result.current.updateSet(0, 0, 'weight', '145'); });

    expect(weights()).toEqual(['145', '145', '145']);
  });

  it('stops at the first set already performed and resumes after it', () => {
    const { result, weights } = harness([
      set(1), set(2, { completed: true }), set(3),
    ]);

    act(() => { result.current.updateSet(0, 0, 'weight', '145'); });

    expect(weights()).toEqual(['145', '135', '145']);
  });

  it('never cascades into an earlier set', () => {
    const { result, weights } = harness([set(1), set(2), set(3)]);

    act(() => { result.current.updateSet(0, 2, 'weight', '145'); });

    expect(weights()).toEqual(['135', '135', '145']);
  });
});
