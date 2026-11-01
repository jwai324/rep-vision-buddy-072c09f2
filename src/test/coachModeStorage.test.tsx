import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { writeStorageCache, readStorageCache, type CachedStorage } from '@/utils/storageCache';
import { queuePendingTemplate, readPendingTemplates } from '@/utils/pendingTemplateWrites';
import type { CoachContextValue } from '@/contexts/CoachContext';

const COACH = 'coach-1';
const CLIENT = 'client-1';

const mocks = vi.hoisted(() => ({
  /** What useCoach answers with; null falls through to the real hook. */
  coach: null as CoachContextValue | null,
  accessLost: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'coach-1' }, session: null, loading: false, signOut: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => mocks.toastError(...a), success: vi.fn() },
}));

// Only useCoach is replaced, and only while a test sets `mocks.coach`: with it
// null the real hook runs, which outside a CoachProvider is the signed-in
// user acting as themselves.
vi.mock('@/contexts/CoachContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/CoachContext')>();
  return { ...actual, useCoach: () => mocks.coach ?? actual.useCoach() };
});

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: unknown };
interface Call { table: string; chain: unknown[][] }

const WRITE_OPS = ['upsert', 'insert', 'update', 'delete'];
const LOAD_ERROR = { code: '500', message: 'server error' };
const WRITE_ERROR = { code: '503', message: 'offline' };
const STAMP = '2026-11-01T12:00:00.000Z';

const db = {
  calls: [] as Call[],
  /** Rows per account, per table. A read answers with the rows of whichever
   *  account its `user_id` filter names, so a query scoped to the wrong
   *  account gets the wrong account's data, as it would under the coach RLS. */
  rows: {} as Record<string, Record<string, unknown>>,
  failTables: new Set<string>(),
  failWrites: false,
};

function answer(call: Call): Answer {
  const ops = call.chain.map(c => c[0] as string);
  const writeOp = ops.find(op => WRITE_OPS.includes(op));
  if (writeOp) {
    if (db.failWrites) return { data: null, error: WRITE_ERROR };
    if (writeOp === 'insert') {
      const payload = call.chain.find(c => c[0] === 'insert')?.[1];
      const inserted = (Array.isArray(payload) ? payload : [payload]) as Row[];
      return {
        data: inserted.map((r, i) => ({ id: `ins-${i}`, created_at: STAMP, recovery_activities: null, ...r })),
        error: null,
      };
    }
    if (writeOp === 'upsert' && ops.includes('single')) return { data: { updated_at: STAMP }, error: null };
    return { data: null, error: null };
  }
  if (db.failTables.has(call.table)) return { data: null, error: LOAD_ERROR };
  const owner = call.chain.find(c => c[0] === 'eq' && c[1] === 'user_id')?.[2] as string | undefined;
  const value = owner ? db.rows[owner]?.[call.table] : undefined;
  if (ops.includes('maybeSingle')) return { data: value ?? null, error: null };
  return { data: value ?? [], error: null };
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, chain: [] };
      db.calls.push(call);
      const builder: Record<string, unknown> = {
        then: (...args: Parameters<Promise<unknown>['then']>) => Promise.resolve(answer(call)).then(...args),
      };
      for (const m of [
        'select', 'eq', 'order', 'range', 'maybeSingle', 'single',
        'upsert', 'insert', 'update', 'delete', 'gte', 'lt', 'or', 'not', 'in',
      ]) {
        builder[m] = (...args: unknown[]) => { call.chain.push([m, ...args]); return builder; };
      }
      return builder;
    },
  },
}));

const { useStorage } = await import('@/hooks/useStorage');

const isWrite = (c: Call) => c.chain.some(([m]) => WRITE_OPS.includes(m as string));
const reads = () => db.calls.filter(c => !isWrite(c));
const writes = (table?: string) => db.calls.filter(c => isWrite(c) && (!table || c.table === table));
const eqValues = (c: Call, column: string) => c.chain.filter(([m, k]) => m === 'eq' && k === column).map(c => c[2]);
const payloadOf = (c: Call, op: string) => c.chain.find(([m]) => m === op)?.[1] as Row;

const LOADED_TABLES = [
  'workout_sessions', 'workout_templates', 'workout_programs', 'future_workouts',
  'user_settings', 'profiles', 'body_measurements',
];

const accountRows = (owner: string, label: string): Record<string, unknown> => ({
  workout_sessions: [{
    id: `${label}-s1`, user_id: owner, date: '2026-10-01', started_at: null, exercises: [], duration: 1800,
    total_volume: 1000, total_sets: 10, total_reps: 60, average_rpe: null,
    note: null, location: null, is_rest_day: false, recovery_activities: null,
  }],
  workout_templates: [{ id: `${label}-t1`, user_id: owner, name: `${label} Push`, exercises: [], updated_at: '2026-10-01T10:00:00.000Z' }],
  workout_programs: [{ id: `${label}-p1`, user_id: owner, name: `${label} PPL`, days: [], duration_weeks: 8, start_date: null, schedule: null }],
  future_workouts: [{
    id: `${label}-fw1`, user_id: owner, program_id: `${label}-p1`, date: '2026-12-02',
    template_id: `${label}-t1`, label: 'Push', completed: false, recovery_activities: null,
  }],
  body_measurements: [{ id: `${label}-bm1`, user_id: owner, date: '2026-10-01', weight_kg: 80 }],
  user_settings: {
    user_id: owner, active_program_id: `${label}-p1`, weight_unit: 'kg',
    default_rest_seconds: 90, default_drop_sets_enabled: false, streak_mode: 'daily',
    streak_weekly_target: 3, streak_adjustment: 0, streak_adjustment_set_at: null,
    tutorial_completed: true, hide_timers: false, custom_locations: ['Home Gym'], sticky_notes: {},
  },
  profiles: {
    user_id: owner, display_name: label, goal: null, hybrid_goals: [], coach_notes: null,
    experience_level: null, equipment: [], injuries: [], age: null, sex: null, height_cm: null,
    subscription_tier: owner === CLIENT ? 'free' : 'premium',
  },
});

/** An account whose stored data would make the two write-back effects fire:
 *  a program day on the old 1–7 weekday numbering, and a streak adjustment set
 *  long ago that an empty history has since broken. */
const healableRows = (owner: string, label: string): Record<string, unknown> => ({
  ...accountRows(owner, label),
  workout_sessions: [],
  workout_programs: [{
    id: `${label}-p1`, user_id: owner, name: `${label} PPL`,
    days: [{ label: 'Push', templateId: `${label}-t1`, frequency: { type: 'weekly', weekday: 7 } }],
    duration_weeks: 4, start_date: null, schedule: null,
  }],
  user_settings: {
    ...(accountRows(owner, label).user_settings as Row),
    streak_adjustment: 12, streak_adjustment_set_at: '2026-09-01',
  },
});

const snapshot = (label: string): CachedStorage => ({
  history: [{ id: `${label}-cached`, date: '2026-08-15', exercises: [], duration: 1800, totalVolume: 1, totalSets: 1, totalReps: 1 }],
  templates: [{ id: `${label}-cached-t`, name: `${label} cached template`, exercises: [] }],
  programs: [],
  activeProgramId: null,
  futureWorkouts: [],
  preferences: {
    weightUnit: 'kg', defaultRestSeconds: 120, defaultDropSetsEnabled: false,
    streakMode: 'daily', streakWeeklyTarget: 3, streakAdjustment: 0,
    streakAdjustmentSetAt: null, tutorialCompleted: true, hideTimers: false,
    customLocations: ['Home Gym'], stickyNotes: {},
  },
  profile: {
    displayName: `${label} cached`, goal: null, hybridGoals: [], coachNotes: null,
    experienceLevel: null, equipment: [], injuries: [], age: null,
    sex: null, heightCm: null, subscriptionTier: 'premium',
  },
  bodyMeasurements: [],
});

const actingAsClient = (): CoachContextValue => ({
  authUserId: COACH,
  ownerId: CLIENT,
  actingAs: { clientId: CLIENT, displayName: 'Casey' },
  clients: [{ linkId: 'link-1', clientId: CLIENT, displayName: 'Casey', linkedAt: '2026-10-01T00:00:00.000Z' }],
  clientsLoaded: true,
  ownTier: 'premium',
  refreshClients: async () => {},
  actAs: () => true,
  stopActing: () => true,
  accessLost: mocks.accessLost,
});

/** Lets the effects that run after a load (snapshot, repair, streak clear)
 *  settle before asserting that they did nothing. */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });

beforeEach(() => {
  localStorage.clear();
  mocks.accessLost.mockReset();
  mocks.toastError.mockReset();
  mocks.coach = null;
  db.calls.length = 0;
  db.rows = { [COACH]: accountRows(COACH, 'coach'), [CLIENT]: accountRows(CLIENT, 'client') };
  db.failTables = new Set();
  db.failWrites = false;
});

describe('useStorage while a coach acts as a client', () => {
  beforeEach(() => { mocks.coach = actingAsClient(); });

  it('scopes every load query to the client, never the coach', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    const loadReads = reads();
    expect(new Set(loadReads.map(c => c.table))).toEqual(new Set(LOADED_TABLES));
    for (const call of loadReads) {
      // RLS lets a coach reach both accounts' rows, so this filter is the only
      // thing keeping the coach's own data out of the client's screen.
      expect(eqValues(call, 'user_id'), call.table).toEqual([CLIENT]);
    }
    expect(result.current.templates.map(t => t.name)).toEqual(['client Push']);
    expect(result.current.history.map(s => s.id)).toEqual(['client-s1']);
    expect(result.current.profile.displayName).toBe('client');
    expect(mocks.accessLost).not.toHaveBeenCalled();
  });

  it('does not paint from a snapshot of the client, even when one is on the device', async () => {
    writeStorageCache(CLIENT, snapshot('client'));

    const { result } = renderHook(() => useStorage());

    // A coach's view always waits for the network: a snapshot would outlive
    // the coach's access to the account.
    expect(result.current.loading).toBe(true);
    expect(result.current.history).toEqual([]);
    expect(result.current.templates).toEqual([]);

    await waitFor(() => expect(result.current.dataTrusted).toBe(true));
    await settle();
    expect(result.current.history.map(s => s.id)).toEqual(['client-s1']);
    // Nor is the stray snapshot refreshed with what the coach just loaded.
    expect(readStorageCache(CLIENT)).toEqual(snapshot('client'));
  });

  it('never writes a snapshot of the client, and leaves the coach\'s own snapshot alone', async () => {
    writeStorageCache(COACH, snapshot('coach'));

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));
    await settle();

    expect(readStorageCache(CLIENT)).toBeNull();
    // Writing any snapshot sweeps every other account's, so the coach's own
    // surviving untouched is what proves nothing was written.
    expect(readStorageCache(COACH)).toEqual(snapshot('coach'));
  });

  it('treats a clean load with no profile row as lost access, and trusts none of it', async () => {
    db.rows[CLIENT] = { ...accountRows(CLIENT, 'client'), profiles: null };

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await settle();

    expect(mocks.accessLost).toHaveBeenCalledWith(CLIENT);
    expect(result.current.dataTrusted).toBe(false);
    // RLS answers an ended link with empty results; none of them is painted
    // as if it were the client's account.
    expect(result.current.templates).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.activeProgramId).toBeNull();
    expect(readStorageCache(CLIENT)).toBeNull();
  });

  it('does not read a failed load as lost access', async () => {
    db.rows[CLIENT] = { ...accountRows(CLIENT, 'client'), profiles: null };
    db.failTables.add('workout_sessions');

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Offline at the gym proves nothing about the link.
    expect(mocks.accessLost).not.toHaveBeenCalled();
    expect(result.current.dataTrusted).toBe(false);
  });

  it('strips subscription_tier from a profile update, and sends nothing when it was all there was', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    await act(async () => { await result.current.updateProfile({ subscriptionTier: 'premium', goal: 'strength' }); });

    const sent = writes('profiles');
    expect(sent).toHaveLength(1);
    const payload = payloadOf(sent[0], 'upsert');
    expect(payload.user_id).toBe(CLIENT);
    expect(payload.goal).toBe('strength');
    expect(payload).not.toHaveProperty('subscription_tier');
    // The plan on screen stays the client's own.
    expect(result.current.profile.subscriptionTier).toBe('free');

    await act(async () => { await result.current.updateProfile({ subscriptionTier: 'premium' }); });
    expect(writes('profiles')).toHaveLength(1);
  });

  it('neither repairs the client\'s program days nor clears their streak adjustment', async () => {
    db.rows[CLIENT] = healableRows(CLIENT, 'client');

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));
    await settle();

    expect(result.current.programs[0].days[0].frequency).toEqual({ type: 'weekly', weekday: 7 });
    expect(result.current.preferences.streakAdjustment).toBe(12);
    // Viewing a client must not rewrite their calendar or settings, which the
    // database would log as the coach's edits.
    expect(writes()).toEqual([]);
  });

  it('saves a template into the client\'s account', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    let ok = false;
    await act(async () => { ok = await result.current.saveTemplate({ id: 't-new', name: 'Coach-made', exercises: [] }); });

    expect(ok).toBe(true);
    const sent = writes('workout_templates');
    expect(sent).toHaveLength(1);
    expect(payloadOf(sent[0], 'upsert')).toMatchObject({ id: 't-new', user_id: CLIENT, name: 'Coach-made' });
  });

  it('parks a failed template save in the client\'s queue, not the coach\'s', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    db.failWrites = true;
    await act(async () => { await result.current.saveTemplate({ id: 't-offline', name: 'Offline edit', exercises: [] }); });

    expect(readPendingTemplates(CLIENT).map(e => e.template.id)).toEqual(['t-offline']);
    expect(readPendingTemplates(COACH)).toEqual([]);
  });

  it('replays the client\'s queued template writes under the client', async () => {
    queuePendingTemplate(CLIENT, { id: 'client-t9', name: 'Queued for client', exercises: [] }, null);

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(readPendingTemplates(CLIENT)).toEqual([]));

    const sent = writes('workout_templates');
    expect(sent).toHaveLength(1);
    expect(payloadOf(sent[0], 'upsert')).toMatchObject({ id: 'client-t9', user_id: CLIENT });
    expect(result.current.templates.map(t => t.id)).toContain('client-t9');
  });

  it('deletes a body measurement only from the client\'s rows', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    let ok = false;
    await act(async () => { ok = await result.current.deleteBodyMeasurement('client-bm1'); });

    expect(ok).toBe(true);
    const sent = writes('body_measurements');
    expect(sent).toHaveLength(1);
    expect(sent[0].chain.some(([m]) => m === 'delete')).toBe(true);
    expect(eqValues(sent[0], 'id')).toEqual(['client-bm1']);
    expect(eqValues(sent[0], 'user_id')).toEqual([CLIENT]);
    expect(result.current.bodyMeasurements).toEqual([]);
  });

  it('deletes a template only from the client\'s rows', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    await act(async () => { await result.current.deleteTemplate('client-t1'); });

    const sent = writes('workout_templates');
    expect(sent).toHaveLength(1);
    expect(eqValues(sent[0], 'user_id')).toEqual([CLIENT]);
  });
});

describe('useStorage with no CoachProvider: the signed-in user as themselves', () => {
  it('loads the signed-in user\'s rows and snapshots them as before', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));
    await settle();

    for (const call of reads()) expect(eqValues(call, 'user_id'), call.table).toEqual([COACH]);
    expect(result.current.templates.map(t => t.name)).toEqual(['coach Push']);
    const cached = readStorageCache(COACH);
    expect(cached?.templates.map(t => t.name)).toEqual(['coach Push']);
  });

  it('still paints from its own snapshot before the network answers', async () => {
    writeStorageCache(COACH, snapshot('coach'));

    const { result } = renderHook(() => useStorage());

    expect(result.current.loading).toBe(false);
    expect(result.current.history.map(s => s.id)).toEqual(['coach-cached']);

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.history.map(s => s.id)).toEqual(['coach-s1']);
  });

  it('still runs the program-day repair and the streak clear on its own account', async () => {
    // The control for the acting test above: the same rows do trigger both
    // write-backs when the account on screen is the signed-in user's.
    db.rows[COACH] = healableRows(COACH, 'coach');

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(writes('workout_programs')).toHaveLength(1));
    await waitFor(() => expect(writes('user_settings')).toHaveLength(1));

    expect(payloadOf(writes('workout_programs')[0], 'upsert')).toMatchObject({ user_id: COACH });
    expect(payloadOf(writes('user_settings')[0], 'upsert')).toMatchObject({
      user_id: COACH, streak_adjustment: 0, streak_adjustment_set_at: null,
    });
    await waitFor(() => expect(result.current.preferences.streakAdjustment).toBe(0));
  });

  it('sends subscription_tier in a profile update', async () => {
    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    await act(async () => { await result.current.updateProfile({ subscriptionTier: 'free' }); });

    const sent = writes('profiles');
    expect(sent).toHaveLength(1);
    expect(payloadOf(sent[0], 'upsert')).toEqual({ user_id: COACH, subscription_tier: 'free' });
  });

  it('trusts a clean load with no profile row: only a coach reads that as lost access', async () => {
    db.rows[COACH] = { ...accountRows(COACH, 'coach'), profiles: null };

    const { result } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.dataTrusted).toBe(true));

    expect(result.current.templates.map(t => t.name)).toEqual(['coach Push']);
  });
});
