import { describe, it, expect } from 'vitest';
import { templateFromSession } from '@/hooks/useScreenHelpers';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { getExerciseInputMode } from '@/utils/exerciseInputMode';
import type { WorkoutSession, WorkoutSet } from '@/types/workout';
import type { CustomExercise } from '@/hooks/useCustomExercises';

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
    const timed = EXERCISE_DATABASE.find(e => getExerciseInputMode(e.id) === 'time');
    expect(timed).toBeDefined();
    const s = session();
    s.exercises = [{ exerciseId: timed!.id, exerciseName: timed!.name, sets: [set({ reps: 1, weight: undefined, time: 90 })] }];
    expect(templateFromSession(s).exercises[0].targetReps).toBe(2);
  });

  it('targets a distance-only exercise by the metres it logged, and nothing else by them', () => {
    // No built-in exercise is pure Distance, so the case needs a custom one.
    const run: CustomExercise = {
      ...EXERCISE_DATABASE[0], id: 'custom-run', name: 'Trail Run', measurementType: 'Distance',
      isCustom: true, isRecovery: false, excludeFromVolume: false,
    };
    const s = session();
    s.exercises = [{ exerciseId: run.id, exerciseName: run.name, sets: [set({ reps: 1, weight: undefined, distance: 5000 })] }];
    expect(templateFromSession(s, undefined, 90, [run]).exercises[0].targetDistance).toBe(5000);

    // A lift that somehow logged a distance is not planned by it.
    const lift = session();
    lift.exercises[0].sets = [set({ distance: 5000 })];
    expect(templateFromSession(lift).exercises[0].targetDistance).toBeUndefined();
  });

  it('targets built-in time-and-distance work by its logged metres, rounded to the metre', () => {
    // Every built-in run, row and swim is Time + Distance. The finish path
    // stores an lbs user's miles as an unrounded metre count.
    const rowing = EXERCISE_DATABASE.find(e => e.id === 'rowing-machine')!;
    const s = session();
    s.exercises = [{ exerciseId: rowing.id, exerciseName: rowing.name, sets: [set({ reps: 1, weight: undefined, time: 1200, distance: 5005.05984 })] }];
    expect(templateFromSession(s).exercises[0].targetDistance).toBe(5005);
  });
});
