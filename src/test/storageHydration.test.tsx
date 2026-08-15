import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { writeStorageCache, type CachedStorage } from '@/utils/storageCache';
import type { WorkoutSession } from '@/types/workout';

const USER_ID = 'user-1';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * Query builder stub. Every chained method returns itself; awaiting the
 * builder resolves only once the test releases it, which is what lets us
 * observe the window where cached data should already be on screen.
 */
let releaseQueries: () => void;
let queryCount = 0;

function makeBuilder() {
  const rows: unknown[] = [];
  const pending = new Promise<{ data: unknown[]; error: null }>(resolve => {
    const prior = releaseQueries;
    releaseQueries = () => { prior?.(); resolve({ data: rows, error: null }); };
  });
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) => pending.then(...args),
  };
  for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle']) {
    builder[m] = () => builder;
  }
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => { queryCount += 1; return makeBuilder(); },
  },
}));

const { useStorage } = await import('@/hooks/useStorage');

const session = (id: string): WorkoutSession => ({
  id, date: '2026-08-15', exercises: [], duration: 1800,
  totalVolume: 100, totalSets: 3, totalReps: 30,
});

const snapshot = (): CachedStorage => ({
  history: [session('cached-1'), session('cached-2')],
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
});

beforeEach(() => {
  localStorage.clear();
  queryCount = 0;
  releaseQueries = () => {};
});

describe('useStorage hydration', () => {
  it('paints cached data immediately instead of a spinner', () => {
    writeStorageCache(USER_ID, snapshot());

    const { result } = renderHook(() => useStorage());

    // This is the whole point: Index gates its full-screen spinner on
    // `loading`, and the network has not answered yet.
    expect(result.current.loading).toBe(false);
    expect(result.current.history).toHaveLength(2);
    expect(result.current.templates[0].name).toBe('Cached Push');
    expect(result.current.preferences.defaultRestSeconds).toBe(120);
    expect(result.current.profile.displayName).toBe('Cached Name');
  });

  it('marks itself as refreshing while it revalidates behind the cached data', () => {
    writeStorageCache(USER_ID, snapshot());

    const { result } = renderHook(() => useStorage());

    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('still revalidates against the network after hydrating', async () => {
    writeStorageCache(USER_ID, snapshot());

    const { result } = renderHook(() => useStorage());
    expect(queryCount).toBeGreaterThan(0);

    await act(async () => { releaseQueries(); });
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    // The stubbed responses are empty, so a completed revalidation replaces
    // the cached rows — proving the network result wins over the snapshot.
    expect(result.current.history).toHaveLength(0);
  });

  it('falls back to the loading state when there is no cache', () => {
    const { result } = renderHook(() => useStorage());

    expect(result.current.loading).toBe(true);
    expect(result.current.history).toHaveLength(0);
  });
});
