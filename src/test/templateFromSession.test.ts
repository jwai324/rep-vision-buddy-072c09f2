import { describe, it, expect } from 'vitest';
import { templateFromSession } from '@/hooks/useScreenHelpers';
import { EXERCISE_DATABASE } from '@/data/exercises';
import type { WorkoutSession, WorkoutSet } from '@/types/workout';

const set = (o: Partial<WorkoutSet> = {}): WorkoutSet => ({ setNumber: 1, type: 'normal', reps: 10, weight: 60, ...o });

const session = (): WorkoutSession => ({
  id: 's1',
  date: '2026-09-01',
  duration: 3600,
  totalVolume: 0,
  totalSets: 0,
  totalReps: 0,
  exercises: [
    { exerciseId: 'a', exerciseName: 'A', supersetGroup: 1, sets: [set()] },
    { exerciseId: 'b', exerciseName: 'B', supersetGroup: 1, sets: [set()] },
    { exerciseId: 'c', exerciseName: 'C', sets: [set()] },
  ],
});

describe('templateFromSession', () => {
  it('keeps the superset links the workout was run with', () => {
    const template = templateFromSession(session(), 'Upper');
    expect(template.exercises.map(e => e.supersetGroup)).toEqual([1, 1, undefined]);
  });

  it('targets the first working set, not a warm-up prepended in front of it', () => {
    const s = session();
    s.exercises[0].sets = [set({ type: 'warmup', reps: 5, weight: 20 }), set({ reps: 8, weight: 80 })];
    const [first] = templateFromSession(s).exercises;

    expect(first.targetReps).toBe(8);
    expect(first.targetWeight).toBe(80);
    expect(first.setType).toBe('normal');
    // The warm-up is not a set to plan either.
    expect(first.sets).toBe(1);
  });

  it('counts working sets only: warm-ups and the drop rows saved beside their parent are not sets to plan', () => {
    const s = session();
    s.exercises[0].sets = [
      set({ type: 'warmup', reps: 5, weight: 20 }),
      set({ reps: 8, weight: 80 }),
      set({ type: 'dropset', reps: 6, weight: 60 }),
      set({ setNumber: 2, reps: 8, weight: 80 }),
      set({ setNumber: 2, type: 'dropset', reps: 6, weight: 60 }),
      set({ setNumber: 3, reps: 8, weight: 80 }),
    ];
    const [first] = templateFromSession(s).exercises;

    expect(first.sets).toBe(3);
    expect(first.targetReps).toBe(8);
    expect(first.targetWeight).toBe(80);
  });

  it('never plans zero sets for an exercise that only logged a warm-up', () => {
    const s = session();
    s.exercises[0].sets = [set({ type: 'warmup', reps: 5, weight: 20 })];
    expect(templateFromSession(s).exercises[0].sets).toBe(1);
  });

  it('targets a timed exercise by its logged length in minutes, not the reps of 1 the finish path writes', () => {
    // The finish path logs a plank as reps 1 with the hold in `time`; the
    // template's target for time-only work is minutes, so 1 was a nonsense
    // target that the editor and the calendar then displayed.
    const timed = EXERCISE_DATABASE.find(e => e.measurementType === 'time');
    expect(timed).toBeDefined();
    const s = session();
    s.exercises = [{ exerciseId: timed!.id, exerciseName: timed!.name, sets: [set({ reps: 1, weight: undefined, time: 90 })] }];
    expect(templateFromSession(s).exercises[0].targetReps).toBe(2);
  });
});
