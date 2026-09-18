import { describe, it, expect } from 'vitest';
import { blockToExercise, exerciseToBlock, type TemplateBlock } from '@/utils/templateBlocks';

const BENCH = 'flat-barbell-bench-press';

const block = (row: Partial<TemplateBlock['sets'][number]>): TemplateBlock => ({
  exerciseId: BENCH,
  exerciseName: 'Bench',
  setType: 'normal',
  restSeconds: 90,
  sets: [{ setNumber: 1, targetWeight: '', targetReps: '10', targetRpe: '', ...row }],
});

describe('blockToExercise target RPE', () => {
  it('keeps the half step the picker offers', () => {
    // parseInt read the picker's "7.5" as 7, so the saved template quietly
    // disagreed with what was chosen.
    expect(blockToExercise(block({ targetRpe: '7.5' })).targetRpe).toBe(7.5);
    expect(blockToExercise(block({ targetRpe: '8' })).targetRpe).toBe(8);
    expect(blockToExercise(block({ targetRpe: '' })).targetRpe).toBeUndefined();
  });

  it('survives a round trip through the editor form', () => {
    const saved = blockToExercise(block({ targetRpe: '7.5' }));
    expect(blockToExercise(exerciseToBlock(saved)).targetRpe).toBe(7.5);
  });
});

describe('blockToExercise target reps', () => {
  it('keeps a typed 0 as 0 rather than turning it into 10', () => {
    expect(blockToExercise(block({ targetReps: '0' })).targetReps).toBe(0);
  });

  it('clamps a negative to 0', () => {
    expect(blockToExercise(block({ targetReps: '-5' })).targetReps).toBe(0);
  });

  it('still reads a blank cell as "to failure"', () => {
    expect(blockToExercise(block({ targetReps: '' })).targetReps).toBe('failure');
    expect(blockToExercise(block({ targetReps: '  ' })).targetReps).toBe('failure');
  });
});
