import { describe, it, expect } from 'vitest';
import type { WorkoutSession } from '@/types/workout';
import {
  volumeExcludedIds,
  countedExercises,
  excludedSessionTotals,
  countedSessionTotals,
} from '@/utils/volumeExclusions';

const WRIST_ISO = 'custom-a402fc10-ff31-4e49-aa8d-0fad094d49a2';

const session: WorkoutSession = {
  id: 's1',
  date: '2026-08-17',
  duration: 3600,
  // 100kg x 5 x 2 working sets + a 60kg x 5 warmup = 1300kg, 3 sets, 15 reps
  // for the squat; the wrist iso adds 5kg x 10 x 2 = 100kg, 2 sets, 20 reps.
  totalVolume: 1400,
  totalSets: 5,
  totalReps: 35,
  exercises: [
    {
      exerciseId: 'barbell-squat',
      exerciseName: 'Barbell Squat',
      sets: [
        { setNumber: 1, type: 'warmup', reps: 5, weight: 60 },
        { setNumber: 2, type: 'normal', reps: 5, weight: 100 },
        { setNumber: 3, type: 'normal', reps: 5, weight: 100 },
      ],
    },
    {
      exerciseId: WRIST_ISO,
      exerciseName: 'Wrist Iso Hold',
      sets: [
        { setNumber: 1, type: 'normal', reps: 10, weight: 5 },
        { setNumber: 2, type: 'normal', reps: 10, weight: 5 },
      ],
    },
  ],
};

describe('volumeExcludedIds', () => {
  it('collects only the flagged custom exercises', () => {
    const ids = volumeExcludedIds([
      { id: WRIST_ISO, excludeFromVolume: true },
      { id: 'custom-other', excludeFromVolume: false },
      { id: 'custom-legacy' },
    ]);
    expect([...ids]).toEqual([WRIST_ISO]);
  });
});

describe('countedExercises', () => {
  it('drops excluded exercises', () => {
    const kept = countedExercises(session.exercises, new Set([WRIST_ISO]));
    expect(kept.map(e => e.exerciseId)).toEqual(['barbell-squat']);
  });

  it('returns the list untouched when nothing is excluded', () => {
    expect(countedExercises(session.exercises, new Set())).toBe(session.exercises);
  });
});

describe('excludedSessionTotals', () => {
  it('counts every set of an excluded exercise, warmups included', () => {
    // Stored totals count warmups, so the subtraction has to as well.
    expect(excludedSessionTotals(session, new Set(['barbell-squat']))).toEqual({
      volume: 1300,
      sets: 3,
      reps: 15,
    });
  });

  it('is zero when nothing is excluded', () => {
    expect(excludedSessionTotals(session, new Set())).toEqual({ volume: 0, sets: 0, reps: 0 });
  });

  it('treats a bodyweight set as zero volume but still a set', () => {
    const bw: WorkoutSession = {
      ...session,
      exercises: [{ exerciseId: 'ex', exerciseName: 'Ex', sets: [{ setNumber: 1, type: 'normal', reps: 12 }] }],
    };
    expect(excludedSessionTotals(bw, new Set(['ex']))).toEqual({ volume: 0, sets: 1, reps: 12 });
  });
});

describe('countedSessionTotals', () => {
  it('nets the excluded exercise back out of the stored totals', () => {
    expect(countedSessionTotals(session, new Set([WRIST_ISO]))).toEqual({
      volume: 1300,
      sets: 3,
      reps: 15,
    });
  });

  it('leaves the stored totals alone when nothing is excluded', () => {
    expect(countedSessionTotals(session, new Set())).toEqual({
      volume: session.totalVolume,
      sets: session.totalSets,
      reps: session.totalReps,
    });
  });

  it('never goes negative when stored totals disagree with the logged sets', () => {
    const stale: WorkoutSession = { ...session, totalVolume: 0, totalSets: 0, totalReps: 0 };
    expect(countedSessionTotals(stale, new Set([WRIST_ISO]))).toEqual({ volume: 0, sets: 0, reps: 0 });
  });
});
