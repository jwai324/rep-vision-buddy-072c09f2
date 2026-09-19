import { describe, it, expect } from 'vitest';
import { blockToExercise, exerciseToBlock, type TemplateBlock } from '@/utils/templateBlocks';
import type { TemplateExercise } from '@/types/workout';

const BENCH = 'flat-barbell-bench-press';

const block = (row: Partial<TemplateBlock['sets'][number]>): TemplateBlock => ({
  exerciseId: BENCH,
  exerciseName: 'Bench',
  setType: 'normal',
  restSeconds: 90,
  sets: [{ setNumber: 1, targetWeight: '', targetReps: '10', targetRpe: '', targetDistance: '', ...row }],
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
  it('floors a typed 0 or negative at 1 rather than saving no target, and never turns it into 10', () => {
    // A zero rep target prefilled every set with 0 reps and let them
    // complete at 0; ten was the old accident.
    expect(blockToExercise(block({ targetReps: '0' })).targetReps).toBe(1);
    expect(blockToExercise(block({ targetReps: '-5' })).targetReps).toBe(1);
  });

  it('reads the same cell as decimal minutes for timed work: 0.5 rounds to 1, not down to 0', () => {
    expect(blockToExercise(block({ targetReps: '0.5' })).targetReps).toBe(1);
    expect(blockToExercise(block({ targetReps: '2.5' })).targetReps).toBe(3);
  });

  it('still reads a blank cell as "to failure"', () => {
    expect(blockToExercise(block({ targetReps: '' })).targetReps).toBe('failure');
    expect(blockToExercise(block({ targetReps: '  ' })).targetReps).toBe('failure');
  });
});

// No built-in exercise is pure Distance, so the box under test needs a custom one.
const RUN = 'custom-run';
const customRun = [{ id: RUN, primaryBodyPart: 'Cardio', equipment: 'None', measurementType: 'Distance' as const }];
const runBlock = (targetDistance: string): TemplateBlock => ({ ...block({ targetDistance, targetReps: 'failure' }), exerciseId: RUN });
const runExercise = (targetDistance: number): TemplateExercise => ({ ...blockToExercise(runBlock(''), 'kg', customRun), targetDistance });

describe('blockToExercise target distance', () => {
  it('saves the km box in metres, rounded to the metre, and reads it back as km', () => {
    // The box used to write into targetWeight, which the save path rightly
    // refuses for distance work, so the number was gone on every reopen.
    const saved = blockToExercise(runBlock('5'), 'kg', customRun);
    expect(saved.targetDistance).toBe(5000);
    expect(saved.targetWeight).toBeUndefined();
    expect(exerciseToBlock(saved, undefined, 'kg', customRun).sets[0].targetDistance).toBe('5');

    expect(blockToExercise(runBlock('2.5'), 'kg', customRun).targetDistance).toBe(2500);
    expect(exerciseToBlock(runExercise(2500), undefined, 'kg', customRun).sets[0].targetDistance).toBe('2.5');
    expect(blockToExercise(runBlock('1.2345'), 'kg', customRun).targetDistance).toBe(1235);
  });

  it('saves no target for a blank, zero, negative or unreadable box', () => {
    for (const cell of ['', '  ', '0', '-3', 'abc']) {
      expect(blockToExercise(runBlock(cell), 'kg', customRun).targetDistance).toBeUndefined();
    }
  });

  it('round-trips a target on time-and-distance work, which has no km box to edit it in', () => {
    // Every built-in run, row and swim is Time + Distance, so this is the
    // mode the coach actually sets a target on. The editor renders no km cell
    // for it, so the string exerciseToBlock filled is what a save reads back
    // — and a save that only renamed the template used to erase the target.
    const rowBlock: TemplateBlock = { ...block({ targetDistance: '5', targetReps: '20' }), exerciseId: 'rowing-machine' };
    const saved = blockToExercise(rowBlock);
    expect(saved.targetDistance).toBe(5000);
    expect(saved.targetWeight).toBeUndefined();
    expect(exerciseToBlock(saved).sets[0].targetDistance).toBe('5');
    expect(blockToExercise(exerciseToBlock(saved)).targetDistance).toBe(5000);
  });

  it('ignores the cell on an exercise that is not measured by distance', () => {
    expect(blockToExercise(block({ targetDistance: '5' })).targetDistance).toBeUndefined();
  });

  it('opens with a blank box for a template saved before the field existed', () => {
    expect(exerciseToBlock(blockToExercise(block({}))).sets[0].targetDistance).toBe('');
  });
});
