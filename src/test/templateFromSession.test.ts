import { describe, it, expect } from 'vitest';
import { templateFromSession } from '@/hooks/useScreenHelpers';
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
});
