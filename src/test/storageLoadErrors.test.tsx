import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

function makeBuilder(table: string) {
  const result = Promise.resolve({ data: null, error: LOAD_ERROR });
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

  it('does not clear a streak adjustment off the back of an empty history', async () => {
    // The sessions query fails, so history is empty; a real adjustment set two
    // weeks ago is still in preferences. The clear effect used to fire here.
    writeStorageCache(USER_ID, snapshot({
      history: [],
      preferences: {
        ...snapshot().preferences,
        streakAdjustment: 12,
        streakAdjustmentSetAt: '2026-09-01',
      },
    }));

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(upserts.filter(u => u.table === 'user_settings')).toHaveLength(0);
    expect(result.current.preferences.streakAdjustment).toBe(12);
  });
});
