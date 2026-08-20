import { describe, it, expect } from 'vitest';
import type { WorkoutSession, WorkoutSet } from '@/types/workout';
import { findPreviousPerformance } from '@/utils/previousPerformance';

const SQUAT = 'barbell-squat';

const set = (over: Partial<WorkoutSet> & { setNumber: number }): WorkoutSet => ({
  type: 'normal',
  reps: 5,
  weight: 100,
  ...over,
});

const session = (
  date: string,
  sets: WorkoutSet[],
  over: Partial<WorkoutSession> = {},
  exerciseId = SQUAT,
): WorkoutSession => ({
  id: `s-${date}-${exerciseId}`,
  date,
  duration: 3600,
  totalVolume: 0,
  totalSets: sets.length,
  totalReps: 0,
  exercises: sets.length
    ? [{ exerciseId, exerciseName: 'Barbell Squat', sets }]
    : [],
  ...over,
});

describe('findPreviousPerformance', () => {
  it('reports nothing for an exercise with no history', () => {
    expect(findPreviousPerformance([], SQUAT)).toEqual({ date: null, sets: [] });
  });

  it('returns each working set of the last session, with its date', () => {
    const history = [
      session('2026-08-18', [
        set({ setNumber: 1, weight: 100, reps: 5 }),
        set({ setNumber: 2, weight: 105, reps: 3 }),
      ]),
      session('2026-08-11', [set({ setNumber: 1, weight: 90, reps: 5 })]),
    ];

    expect(findPreviousPerformance(history, SQUAT)).toEqual({
      date: '2026-08-18',
      sets: [
        { weight: 100, reps: 5, rpe: undefined, time: undefined },
        { weight: 105, reps: 3, rpe: undefined, time: undefined },
      ],
    });
  });

  it('picks the newest session by date, not by position in the list', () => {
    // A workout logged for an earlier day lands at the front of history, so
    // taking the first match would quote the older numbers.
    const history = [
      session('2026-08-04', [set({ setNumber: 1, weight: 80, reps: 5 })]),
      session('2026-08-18', [set({ setNumber: 1, weight: 110, reps: 5 })]),
    ];

    expect(findPreviousPerformance(history, SQUAT)).toMatchObject({
      date: '2026-08-18',
      sets: [{ weight: 110, reps: 5 }],
    });
  });

  it('breaks a same-day tie on start time', () => {
    const history = [
      session('2026-08-18', [set({ setNumber: 1, weight: 100 })], { startedAt: '2026-08-18T08:00:00Z' }),
      session('2026-08-18', [set({ setNumber: 1, weight: 120 })], { startedAt: '2026-08-18T17:00:00Z' }),
    ];

    expect(findPreviousPerformance(history, SQUAT).sets[0].weight).toBe(120);
  });

  it('leaves warmups out so the rows line up with working sets', () => {
    const history = [
      session('2026-08-18', [
        set({ setNumber: 1, type: 'warmup', weight: 60, reps: 8 }),
        set({ setNumber: 2, weight: 100, reps: 5 }),
      ]),
    ];

    expect(findPreviousPerformance(history, SQUAT).sets).toEqual([
      { weight: 100, reps: 5, rpe: undefined, time: undefined },
    ]);
  });

  it('leaves dropsets out, which otherwise shift every later set', () => {
    // Dropsets are saved as extra rows under their parent's set number, while
    // the live table nests them inside the parent row.
    const history = [
      session('2026-08-18', [
        set({ setNumber: 1, weight: 100, reps: 8 }),
        set({ setNumber: 1, type: 'dropset', weight: 70, reps: 6 }),
        set({ setNumber: 2, weight: 100, reps: 7 }),
      ]),
    ];

    expect(findPreviousPerformance(history, SQUAT).sets).toEqual([
      { weight: 100, reps: 8, rpe: undefined, time: undefined },
      { weight: 100, reps: 7, rpe: undefined, time: undefined },
    ]);
  });

  it('keeps looking back past a session that was only warmed up', () => {
    const history = [
      session('2026-08-18', [set({ setNumber: 1, type: 'warmup', weight: 60, reps: 8 })]),
      session('2026-08-11', [set({ setNumber: 1, weight: 95, reps: 5 })]),
    ];

    expect(findPreviousPerformance(history, SQUAT)).toMatchObject({
      date: '2026-08-11',
      sets: [{ weight: 95, reps: 5 }],
    });
  });

  it('ignores sessions that never touched the exercise', () => {
    const history = [
      session('2026-08-18', [set({ setNumber: 1, weight: 40 })], {}, 'bench-press'),
      session('2026-08-11', [set({ setNumber: 1, weight: 95 })]),
    ];

    expect(findPreviousPerformance(history, SQUAT)).toMatchObject({ date: '2026-08-11' });
  });

  it('skips rest days', () => {
    const history = [
      session('2026-08-19', [], { isRestDay: true }),
      session('2026-08-18', [set({ setNumber: 1, weight: 100 })]),
    ];

    expect(findPreviousPerformance(history, SQUAT).date).toBe('2026-08-18');
  });

  it('carries rpe and time through for the modes that show them', () => {
    const history = [
      session('2026-08-18', [set({ setNumber: 1, weight: 40, reps: 1, rpe: 8, time: 45 })]),
    ];

    expect(findPreviousPerformance(history, SQUAT).sets[0]).toEqual({
      weight: 40, reps: 1, rpe: 8, time: 45,
    });
  });
});
