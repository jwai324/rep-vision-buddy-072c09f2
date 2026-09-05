import { describe, it, expect } from 'vitest';
import {
  getFutureWorkoutsCompletedBySession,
  getScheduledWorkoutsForDate,
} from '@/utils/scheduledWorkout';
import type { FutureWorkout, WorkoutProgram, WorkoutTemplate, WorkoutSession } from '@/types/workout';

const PROGRAM_ID = 'prog-1';

function fw(overrides: Partial<FutureWorkout> = {}): FutureWorkout {
  return {
    id: 'fw-1',
    programId: PROGRAM_ID,
    date: '2026-08-15',
    templateId: 'tpl-push',
    label: 'Push Day',
    ...overrides,
  };
}

function session(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'sess-1',
    date: '2026-08-15',
    exercises: [],
    duration: 3600,
    totalVolume: 1000,
    totalSets: 12,
    totalReps: 120,
    ...overrides,
  };
}

describe('getFutureWorkoutsCompletedBySession', () => {
  it('matches the scheduled workout on the session date', () => {
    const scheduled = [fw()];
    expect(getFutureWorkoutsCompletedBySession(session(), scheduled)).toEqual([scheduled[0]]);
  });

  it('ignores scheduled entries on other dates', () => {
    const scheduled = [fw({ date: '2026-08-16' })];
    expect(getFutureWorkoutsCompletedBySession(session(), scheduled)).toEqual([]);
  });

  it('does not re-match entries already marked done', () => {
    const scheduled = [fw({ completed: true })];
    expect(getFutureWorkoutsCompletedBySession(session(), scheduled)).toEqual([]);
  });

  it('logging a workout leaves a scheduled rest day alone', () => {
    const scheduled = [fw({ id: 'fw-rest', templateId: 'rest', label: 'Rest Day' })];
    expect(getFutureWorkoutsCompletedBySession(session(), scheduled)).toEqual([]);
  });

  it('logging a rest day leaves a scheduled workout alone', () => {
    const rest = fw({ id: 'fw-rest', templateId: 'rest', label: 'Rest Day' });
    const workout = fw();
    const matched = getFutureWorkoutsCompletedBySession(
      session({ isRestDay: true }),
      [workout, rest],
    );
    expect(matched).toEqual([rest]);
  });

  it('handles session dates carrying a time component', () => {
    const scheduled = [fw()];
    const matched = getFutureWorkoutsCompletedBySession(
      session({ date: '2026-08-15T18:30:00' }),
      scheduled,
    );
    expect(matched).toEqual([scheduled[0]]);
  });
});

describe('a completed day still exposes what was scheduled', () => {
  const program: WorkoutProgram = {
    id: PROGRAM_ID,
    name: 'Hybrid',
    startDate: '2026-08-10',
    durationWeeks: 4,
    days: [{ label: 'Push Day', templateId: 'tpl-push', frequency: { type: 'weekly', weekday: 6 } }],
  };
  const templates: WorkoutTemplate[] = [{ id: 'tpl-push', name: 'Push', exercises: [] }];

  it('keeps the entry startable once it is flagged done', () => {
    const done = fw({ completed: true });
    const results = getScheduledWorkoutsForDate('2026-08-15', program, [done], templates);

    expect(results).toHaveLength(1);
    expect(results[0].template).toEqual(templates[0]);
    expect(results[0].futureWorkout?.completed).toBe(true);
  });
});

describe('a day with two scheduled workouts', () => {
  const push = fw({ id: 'fw-push', templateId: 'tpl-push', label: 'Push' });
  const legs = fw({ id: 'fw-legs', templateId: 'tpl-legs', label: 'Legs' });
  const templates: WorkoutTemplate[] = [
    { id: 'tpl-push', name: 'Push', exercises: [
      { exerciseId: 'bench', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
      { exerciseId: 'ohp', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
    ] },
    { id: 'tpl-legs', name: 'Legs', exercises: [
      { exerciseId: 'squat', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
      { exerciseId: 'rdl', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
    ] },
  ];
  const logged = (...ids: string[]) => ids.map(exerciseId => ({ exerciseId, exerciseName: exerciseId, sets: [] }));

  it('marks only the workout the session was started from', () => {
    const matched = getFutureWorkoutsCompletedBySession(session(), [push, legs], { templateId: 'tpl-legs', templates });
    expect(matched).toEqual([legs]);
  });

  it('marks nothing when a finished workout is done again while the other is outstanding', () => {
    const matched = getFutureWorkoutsCompletedBySession(
      session(),
      [{ ...push, completed: true }, legs],
      { templateId: 'tpl-push', templates },
    );
    expect(matched).toEqual([]);
  });

  it('matches a session with no template by the exercises it logged', () => {
    const matched = getFutureWorkoutsCompletedBySession(
      session({ exercises: logged('squat', 'rdl') }),
      [push, legs],
      { templates },
    );
    expect(matched).toEqual([legs]);
  });

  it('falls back to the first scheduled workout when nothing tells them apart', () => {
    const matched = getFutureWorkoutsCompletedBySession(session(), [push, legs], { templates });
    expect(matched).toEqual([push]);
  });

  it('still counts a substituted workout against the one entry on a single-workout day', () => {
    const matched = getFutureWorkoutsCompletedBySession(session(), [push], { templateId: 'tpl-legs', templates });
    expect(matched).toEqual([push]);
  });

  it('never marks more than one workout for one session', () => {
    const matched = getFutureWorkoutsCompletedBySession(session(), [push, legs]);
    expect(matched).toHaveLength(1);
  });
});
