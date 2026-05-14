import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlockMutations } from '@/hooks/useBlockMutations';
import type { ExerciseBlock } from '@/types/activeSession';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeBlock(): ExerciseBlock {
  return {
    exerciseId: 'bench-press' as ExerciseBlock['exerciseId'],
    exerciseName: 'Bench Press',
    restSeconds: 90,
    sets: [
      { setNumber: 1, weight: '135', reps: '10', rpe: '8', time: '', completed: false, type: 'normal' },
      { setNumber: 2, weight: '135', reps: '10', rpe: '',  time: '', completed: false, type: 'normal' },
      { setNumber: 3, weight: '135', reps: '10', rpe: '',  time: '', completed: false, type: 'normal' },
    ],
  };
}

describe('RPE auto-copy on set complete', () => {
  it("copies the completed set's RPE into the next set's empty RPE field", () => {
    let blocks: ExerciseBlock[] = [makeBlock()];
    const setBlocks = (updater: (prev: ExerciseBlock[]) => ExerciseBlock[]) => {
      blocks = typeof updater === 'function' ? (updater as any)(blocks) : updater;
    };

    const { result } = renderHook(() =>
      useBlockMutations(blocks, setBlocks as any, {
        weightUnit: 'lbs',
        defaultDropSetsEnabled: false,
        customExercises: [],
        startTimer: vi.fn(),
      }),
    );

    act(() => {
      result.current.toggleSetComplete(0, 0);
    });

    expect(blocks[0].sets[0].completed).toBe(true);
    expect(blocks[0].sets[1].rpe).toBe('8');
    expect(blocks[0].sets[2].rpe).toBe('8');
  });

  it("does not overwrite the next set's RPE if the user already entered one", () => {
    const block = makeBlock();
    block.sets[1].rpe = '9'; // user already set RPE for set 2
    let blocks: ExerciseBlock[] = [block];
    const setBlocks = (updater: (prev: ExerciseBlock[]) => ExerciseBlock[]) => {
      blocks = typeof updater === 'function' ? (updater as any)(blocks) : updater;
    };

    const { result } = renderHook(() =>
      useBlockMutations(blocks, setBlocks as any, {
        weightUnit: 'lbs',
        defaultDropSetsEnabled: false,
        customExercises: [],
        startTimer: vi.fn(),
      }),
    );

    act(() => {
      result.current.toggleSetComplete(0, 0);
    });

    // Set 1 was completed with RPE 8 but Set 2 keeps its user-entered RPE 9
    expect(blocks[0].sets[1].rpe).toBe('9');
    // Set 3 was empty, so it picks up the completed set's RPE
    expect(blocks[0].sets[2].rpe).toBe('8');
  });
});
