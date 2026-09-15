import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { writeStorageCache, readStorageCache, type CachedStorage } from '@/utils/storageCache';
import type { WorkoutSession } from '@/types/workout';

const USER_ID = 'user-err';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

// postgrest-js resolves with an `error` payload rather than throwing — for
// server errors *and* for a rejected fetch. This stub reproduces that.
const LOAD_ERROR = { code: '500', message: 'server error' };

const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

/** Rows a table should return instead of failing. Tables absent from it fail. */
let succeedWith: Record<string, unknown> = {};

function makeBuilder(table: string) {
  const ok = Object.prototype.hasOwnProperty.call(succeedWith, table);
  const result = Promise.resolve(
    ok ? { data: succeedWith[table], error: null } : { data: null, error: LOAD_ERROR },
  );
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    upsert: (payload: Record<string, unknown>) => {
      upserts.push({ table, payload });
      return Promise.resolve({ data: null, error: null });
    },
  };
  for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle']) builder[m] = () => builder;
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

const { useStorage } = await import('@/hooks/useStorage');

const session = (id: string): WorkoutSession => ({
  id, date: '2026-08-15', exercises: [], duration: 1800,
  totalVolume: 100, totalSets: 3, totalReps: 30,
});

const snapshot = (over: Partial<CachedStorage> = {}): CachedStorage => ({
  history: [session('cached-1')],
  templates: [{ id: 't1', name: 'Cached Push', exercises: [] }],
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
    displayName: 'Cached Name', goal: null, hybridGoals: [], coachNotes: null,
    experienceLevel: null, equipment: [], injuries: [], age: null,
    sex: null, heightCm: null, subscriptionTier: 'premium',
  },
  bodyMeasurements: [],
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  toastError.mockClear();
  upserts.length = 0;
  succeedWith = {};
});

describe('useStorage load failures', () => {
  it('tells the user instead of painting a silent empty account', async () => {
    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(toastError).toHaveBeenCalledWith('Failed to load your data');
  });

  it('never caches the blank state a failed first load leaves behind', async () => {
    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Caching this would make the next open paint an empty account as
    // last-known-good and re-run the tutorial over real history.
    expect(readStorageCache(USER_ID)).toBeNull();
  });

  it('keeps cached data on screen and says the refresh failed', async () => {
    writeStorageCache(USER_ID, snapshot());

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.templates[0].name).toBe('Cached Push');
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't refresh your data — showing what was last saved.",
    );
  });

  it('does not clear a streak adjustment off the back of a half-loaded account', async () => {
    // The audit's partial-failure case, and the one that cost a real streak:
    // the 500-row workout_sessions read times out while user_settings succeeds
    // and returns a genuine adjustment set two weeks ago. There is no cache, so
    // history is [] purely because of the failure — which the streak maths
    // reads as "the streak broke".
    succeedWith = {
      user_settings: {
        user_id: USER_ID, weight_unit: 'kg', default_rest_seconds: 90,
        default_drop_sets_enabled: false, streak_mode: 'daily',
        streak_weekly_target: 3, streak_adjustment: 12,
        streak_adjustment_set_at: '2026-09-01', tutorial_completed: true,
        hide_timers: false, custom_locations: ['Home Gym'], sticky_notes: {},
        active_program_id: null,
      },
    };

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.history).toHaveLength(0);
    expect(result.current.preferences.streakAdjustment).toBe(12);
    // Nothing may be written back on the strength of that empty history.
    expect(upserts.filter(u => u.table === 'user_settings')).toHaveLength(0);
  });

  it('refuses whole-row writes built from placeholder state', async () => {
    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataTrusted).toBe(false);

    // Finishing the tutorial, or the coach writing one profile field, upserts
    // the whole row from local state — which is DEFAULT_* here.
    await act(async () => { await result.current.updatePreferences({ tutorialCompleted: true }); });
    await act(async () => { await result.current.updateProfile({ goal: 'strength' }); });

    expect(upserts).toHaveLength(0);
  });

  it('trusts a successful load even when the account is genuinely empty', async () => {
    succeedWith = {
      workout_sessions: [], workout_templates: [], workout_programs: [],
      future_workouts: [], user_settings: null, profiles: null,
      body_measurements: [],
    };

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataTrusted).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
    // A real empty account is still worth caching as last-known-good.
    expect(readStorageCache(USER_ID)).not.toBeNull();
  });
});
