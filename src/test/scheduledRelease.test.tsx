import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { FutureWorkout, WorkoutSession, WorkoutTemplate } from '@/types/workout';

const USER_ID = 'user-release';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, reconnecting: false, signOut: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Rows each table hands back to the load, keyed by table name. */
let rows: Record<string, unknown[]> = {};
/** Every `update` the hook sent, in order. */
let updates: Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
/** Tables whose writes should come back refused. */
let writeFails = new Set<string>();

function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const loadResult = { data: rows[table] ?? [], error: null };
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) => Promise.resolve(loadResult).then(...args),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    update: (payload: Record<string, unknown>) => {
      const write: Record<string, unknown> = {
        then: (...args: Parameters<Promise<unknown>['then']>) =>
          Promise.resolve({ data: null, error: writeFails.has(table) ? { message: 'refused' } : null }).then(...args),
      };
      write.eq = (col: string, val: unknown) => { filters.push([col, val]); return write; };
      updates.push({ table, payload, filters });
      return write;
    },
    delete: () => {
      const write: Record<string, unknown> = {
        then: (...args: Parameters<Promise<unknown>['then']>) =>
          Promise.resolve({ data: null, error: writeFails.has(table) ? { message: 'refused' } : null }).then(...args),
      };
      write.eq = () => write;
      return write;
    },
  };
  for (const m of ['select', 'eq', 'order', 'range']) builder[m] = () => builder;
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

const { useStorage, futureWorkoutsReleasedOnDate } = await import('@/hooks/useStorage');

const PROGRAM = '11111111-2222-4333-8444-555555555555';
const DATE = '2026-09-10';

const sessionRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER_ID, date: DATE, started_at: null, exercises: [],
  duration: 1800, total_volume: 0, total_sets: 0, total_reps: 0,
  average_rpe: null, note: null, location: null, is_rest_day: false,
  recovery_activities: null, ...over,
});

const fwRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER_ID, program_id: PROGRAM, date: DATE,
  template_id: 'tpl-push', label: 'Push Day', completed: true,
  recovery_activities: null, ...over,
});

const templateRow = (id: string, name: string, exerciseIds: string[]) => ({
  id, user_id: USER_ID, name, updated_at: '2026-09-01T00:00:00Z',
  exercises: exerciseIds.map(exerciseId => ({ exerciseId, sets: 3, targetReps: 10 })),
});

const mountLoaded = async () => {
  const hook = renderHook(() => useStorage());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

const completedUpdates = () => updates.filter(u => u.table === 'future_workouts');

beforeEach(() => {
  localStorage.clear();
  rows = {};
  updates = [];
  writeFails = new Set();
});

// A deleted (or re-dated) workout used to leave the plan it ticked off still
// marked done, so the calendar showed an empty day over a day the program
// counted as complete.
describe('deleting a logged workout', () => {
  it('puts the scheduled workout it completed back to outstanding', async () => {
    rows = {
      workout_sessions: [sessionRow('s1')],
      workout_templates: [templateRow('tpl-push', 'Push Day', ['bench-press'])],
      future_workouts: [fwRow('fw1')],
    };
    const { result } = await mountLoaded();
    expect(result.current.futureWorkouts[0].completed).toBe(true);

    await act(async () => { await result.current.deleteSession('s1'); });

    expect(completedUpdates()).toHaveLength(1);
    expect(completedUpdates()[0].payload).toEqual({ completed: false });
    expect(completedUpdates()[0].filters).toContainEqual(['id', 'fw1']);
    expect(result.current.futureWorkouts[0].completed).toBe(false);
  });

  it('leaves the tick alone while another session on the day still accounts for it', async () => {
    rows = {
      workout_sessions: [sessionRow('s1'), sessionRow('s2')],
      workout_templates: [templateRow('tpl-push', 'Push Day', ['bench-press'])],
      future_workouts: [fwRow('fw1')],
    };
    const { result } = await mountLoaded();

    await act(async () => { await result.current.deleteSession('s1'); });

    expect(completedUpdates()).toHaveLength(0);
    expect(result.current.futureWorkouts[0].completed).toBe(true);
  });

  it('releases one tick per deletion when the day scheduled two workouts', async () => {
    rows = {
      workout_sessions: [sessionRow('s1'), sessionRow('s2')],
      workout_templates: [
        templateRow('tpl-push', 'Push Day', ['bench-press']),
        templateRow('tpl-legs', 'Leg Day', ['back-squat']),
      ],
      future_workouts: [
        fwRow('fw1'),
        fwRow('fw2', { template_id: 'tpl-legs', label: 'Leg Day' }),
      ],
    };
    const { result } = await mountLoaded();

    await act(async () => { await result.current.deleteSession('s1'); });
    expect(completedUpdates()).toHaveLength(1);
    expect(result.current.futureWorkouts.filter(fw => fw.completed)).toHaveLength(1);

    await act(async () => { await result.current.deleteSession('s2'); });
    expect(completedUpdates()).toHaveLength(2);
    expect(result.current.futureWorkouts.filter(fw => fw.completed)).toHaveLength(0);
  });

  it('never ticks a scheduled workout off against a deleted rest day', async () => {
    rows = {
      workout_sessions: [sessionRow('rest1', { is_rest_day: true })],
      workout_templates: [templateRow('tpl-push', 'Push Day', ['bench-press'])],
      future_workouts: [fwRow('fw1')],
    };
    const { result } = await mountLoaded();

    await act(async () => { await result.current.deleteSession('rest1'); });

    expect(completedUpdates()).toHaveLength(0);
  });

  it('keeps the tick on screen when the server refuses the release', async () => {
    rows = {
      workout_sessions: [sessionRow('s1')],
      workout_templates: [templateRow('tpl-push', 'Push Day', ['bench-press'])],
      future_workouts: [fwRow('fw1')],
    };
    writeFails = new Set(['future_workouts']);
    const { result } = await mountLoaded();

    await act(async () => { await result.current.deleteSession('s1'); });

    expect(result.current.futureWorkouts[0].completed).toBe(true);
  });
});

describe('moving a logged workout to another date', () => {
  it('clears the tick on the date it left', async () => {
    rows = {
      workout_sessions: [sessionRow('s1')],
      workout_templates: [templateRow('tpl-push', 'Push Day', ['bench-press'])],
      future_workouts: [fwRow('fw1')],
    };
    const { result } = await mountLoaded();
    const moved: WorkoutSession = { ...result.current.history[0], date: '2026-09-12' };

    // The edit screen's save: a correction is not a workout done, so the new
    // date is not ticked off either.
    await act(async () => { await result.current.saveSession(moved, { markScheduled: false }); });

    expect(completedUpdates()).toHaveLength(1);
    expect(completedUpdates()[0].payload).toEqual({ completed: false });
    expect(completedUpdates()[0].filters).toContainEqual(['id', 'fw1']);
    expect(result.current.futureWorkouts[0].completed).toBe(false);
  });

  it('leaves the old date alone when only the contents changed', async () => {
    rows = {
      workout_sessions: [sessionRow('s1')],
      workout_templates: [templateRow('tpl-push', 'Push Day', ['bench-press'])],
      future_workouts: [fwRow('fw1')],
    };
    const { result } = await mountLoaded();
    const edited: WorkoutSession = { ...result.current.history[0], note: 'felt strong' };

    await act(async () => { await result.current.saveSession(edited, { markScheduled: false }); });

    expect(completedUpdates()).toHaveLength(0);
    expect(result.current.futureWorkouts[0].completed).toBe(true);
  });
});

// An empty rest day has to be an ordinary rest day: saved, in history, and
// ticking off the scheduled rest it was logged against.
describe('a rest day saved with no recovery activities', () => {
  it('lands in history and marks the day\'s scheduled rest done', async () => {
    rows = {
      workout_sessions: [],
      workout_templates: [],
      future_workouts: [fwRow('fw-rest', { template_id: 'rest', label: 'Rest Day', completed: false })],
    };
    const { result } = await mountLoaded();

    const bare: WorkoutSession = {
      id: 'rest-1', date: DATE, exercises: [], duration: 0,
      totalVolume: 0, totalSets: 0, totalReps: 0, isRestDay: true,
    };
    let saved = false;
    await act(async () => { saved = await result.current.saveSession(bare); });

    expect(saved).toBe(true);
    expect(result.current.history.map(s => s.id)).toContain('rest-1');
    expect(completedUpdates()).toHaveLength(1);
    expect(completedUpdates()[0].payload).toEqual({ completed: true });
    expect(result.current.futureWorkouts[0].completed).toBe(true);
  });
});

describe('futureWorkoutsReleasedOnDate', () => {
  const fw = (id: string, over: Partial<FutureWorkout> = {}): FutureWorkout => ({
    id, programId: PROGRAM, date: DATE, templateId: 'tpl-push',
    label: 'Push Day', completed: true, ...over,
  });
  const session = (id: string, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
    id, date: DATE, exercises: [], duration: 0,
    totalVolume: 0, totalSets: 0, totalReps: 0, ...over,
  });

  it('ignores entries on other dates and entries that were never ticked', () => {
    const released = futureWorkoutsReleasedOnDate(DATE, false, [
      fw('same-day'),
      fw('other-day', { date: '2026-09-11' }),
      fw('never-done', { completed: false }),
    ], [], []);

    expect(released.map(r => r.id)).toEqual(['same-day']);
  });

  it('releases every scheduled rest on the day once no rest session is left', () => {
    const rest = [fw('r1', { templateId: 'rest' }), fw('r2', { templateId: 'rest' })];

    expect(futureWorkoutsReleasedOnDate(DATE, true, rest, [], []).map(r => r.id)).toEqual(['r1', 'r2']);
    expect(futureWorkoutsReleasedOnDate(DATE, true, rest, [session('s', { isRestDay: true })], [])).toHaveLength(0);
  });

  it('gives the remaining session the entry its exercises match', () => {
    const templates: WorkoutTemplate[] = [
      { id: 'tpl-push', name: 'Push Day', exercises: [{ exerciseId: 'bench-press', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }] },
      { id: 'tpl-legs', name: 'Leg Day', exercises: [{ exerciseId: 'back-squat', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }] },
    ];
    const remaining = [session('s-legs', {
      exercises: [{ exerciseId: 'back-squat', exerciseName: 'Back Squat', sets: [] }],
    })];

    const released = futureWorkoutsReleasedOnDate(DATE, false, [
      fw('fw-push'),
      fw('fw-legs', { templateId: 'tpl-legs', label: 'Leg Day' }),
    ], remaining, templates);

    expect(released.map(r => r.id)).toEqual(['fw-push']);
  });
});
