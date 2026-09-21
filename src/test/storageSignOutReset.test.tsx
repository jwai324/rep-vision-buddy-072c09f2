import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const USER_ID = 'user-signout';

/** Swapped to null mid-test, the way AuthContext reports a SIGNED_OUT event. */
let currentUser: { id: string } | null = { id: USER_ID };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, session: null, loading: false, signOut: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** What each table answers with. `maybeSingle` reads use the same entry. */
const rows: Record<string, unknown> = {
  workout_sessions: [{
    id: 's1', user_id: USER_ID, date: '2026-09-01', exercises: [], duration: 1800,
    total_volume: 1000, total_sets: 10, total_reps: 60, average_rpe: null,
    note: null, location: null, is_rest_day: false, recovery_activities: null,
  }],
  workout_templates: [{ id: 't1', user_id: USER_ID, name: 'Push', exercises: [], updated_at: '2026-09-01T10:00:00.000Z' }],
  workout_programs: [{ id: 'p1', user_id: USER_ID, name: 'PPL', days: [], duration_weeks: 8, start_date: null, schedule: null }],
  future_workouts: [{
    id: 'fw1', user_id: USER_ID, program_id: 'p1', date: '2026-09-02',
    template_id: 't1', label: 'Push', completed: false, recovery_activities: null,
  }],
  body_measurements: [{ id: 'bm1', user_id: USER_ID, date: '2026-09-01', weight_kg: 80 }],
  user_settings: {
    user_id: USER_ID, active_program_id: 'p1', weight_unit: 'kg',
    default_rest_seconds: 90, default_drop_sets_enabled: false, streak_mode: 'daily',
    streak_weekly_target: 3, streak_adjustment: 0, streak_adjustment_set_at: null,
    tutorial_completed: true, hide_timers: false, custom_locations: ['Home Gym'], sticky_notes: {},
  },
  profiles: { user_id: USER_ID, display_name: 'Signed In', subscription_tier: 'premium' },
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const result = Promise.resolve({ data: rows[table] ?? [], error: null });
      const builder: Record<string, unknown> = {
        then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
        upsert: () => Promise.resolve({ data: null, error: null }),
      };
      for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle']) builder[m] = () => builder;
      return builder;
    },
  },
}));

const { useStorage } = await import('@/hooks/useStorage');

beforeEach(() => {
  localStorage.clear();
  currentUser = { id: USER_ID };
});

describe('useStorage when the user goes away', () => {
  it('clears every user-scoped slice, the active program id included', async () => {
    const { result, rerender } = renderHook(() => useStorage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeProgramId).toBe('p1');
    expect(result.current.history).toHaveLength(1);

    // auth-js ends the session by itself when a refresh is refused, so this
    // is not only the Sign Out button: whatever is still on screen belongs to
    // the account that just left, and the next one must not inherit it.
    currentUser = null;
    rerender();

    expect(result.current.activeProgramId).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.templates).toEqual([]);
    expect(result.current.programs).toEqual([]);
    expect(result.current.futureWorkouts).toEqual([]);
    expect(result.current.bodyMeasurements).toEqual([]);
    // Nothing loaded means nothing on screen can be written back as if it had.
    expect(result.current.dataTrusted).toBe(false);
    expect(result.current.loading).toBe(false);
  });
});
