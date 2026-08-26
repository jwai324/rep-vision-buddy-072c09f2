import { describe, it, expect } from 'vitest';
import { repairBlockNames, resolveExerciseName } from '@/utils/exerciseNames';

const lookup = {
  'bench-press': 'Bench Press',
  'custom-95ca6d55': 'Wall Sit Hold',
};

describe('resolveExerciseName', () => {
  it('prefers the live library name over the stored one', () => {
    expect(resolveExerciseName(lookup, 'custom-95ca6d55', 'custom-95ca6d55')).toBe('Wall Sit Hold');
  });

  it('keeps the stored name when the library no longer knows the id', () => {
    expect(resolveExerciseName(lookup, 'custom-deleted', 'Retired Lift')).toBe('Retired Lift');
  });
});

describe('repairBlockNames', () => {
  it('replaces a raw id that was baked in before the custom library loaded', () => {
    const blocks = [
      { exerciseId: 'bench-press', exerciseName: 'Bench Press', sets: [] },
      { exerciseId: 'custom-95ca6d55', exerciseName: 'custom-95ca6d55', sets: [] },
    ];
    const repaired = repairBlockNames(blocks, lookup);
    expect(repaired.map(b => b.exerciseName)).toEqual(['Bench Press', 'Wall Sit Hold']);
  });

  it('carries the rest of the block through untouched', () => {
    const blocks = [{ exerciseId: 'custom-95ca6d55', exerciseName: 'custom-95ca6d55', restSeconds: 45, sets: [{ setNumber: 1 }] }];
    const [repaired] = repairBlockNames(blocks, lookup);
    expect(repaired.restSeconds).toBe(45);
    expect(repaired.sets).toBe(blocks[0].sets);
  });

  it('returns the same array reference when every name already resolves', () => {
    const blocks = [{ exerciseId: 'bench-press', exerciseName: 'Bench Press' }];
    expect(repairBlockNames(blocks, lookup)).toBe(blocks);
  });

  it('leaves an id the library does not know alone', () => {
    const blocks = [{ exerciseId: 'custom-deleted', exerciseName: 'custom-deleted' }];
    expect(repairBlockNames(blocks, lookup)).toBe(blocks);
  });

  it('adopts a rename made in the custom exercise library', () => {
    const blocks = [{ exerciseId: 'custom-95ca6d55', exerciseName: 'Old Name' }];
    expect(repairBlockNames(blocks, lookup)[0].exerciseName).toBe('Wall Sit Hold');
  });
});
