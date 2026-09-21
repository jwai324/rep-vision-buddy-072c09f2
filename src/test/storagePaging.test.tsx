import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readStorageCache } from '@/utils/storageCache';

const USER_ID = 'user-paging';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

type Answer = { data: unknown; error: unknown };

/** Pages a table answers with, in order. A table with none comes back empty. */
let pages: Record<string, Answer[]> = {};
/** Tables that answer every page, forever, with the same full page. */
let endless: Record<string, Answer> = {};
/** Every builder the hook constructed, with the chain of calls made on it. */
let chains: Array<{ table: string; chain: unknown[][] }> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const chain: unknown[][] = [];
      chains.push({ table, chain });
      const builder: Record<string, unknown> = {
        then: (...args: Parameters<Promise<unknown>['then']>) => {
          const single = chain.some(c => c[0] === 'maybeSingle');
          const answer: Answer = single
            ? { data: null, error: null }
            : (pages[table]?.shift() ?? endless[table] ?? { data: [], error: null });
          return Promise.resolve(answer).then(...args);
        },
        upsert: () => Promise.resolve({ data: null, error: null }),
      };
      for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle']) {
        builder[m] = (...args: unknown[]) => { chain.push([m, ...args]); return builder; };
      }
      return builder;
    },
  },
}));

const { useStorage } = await import('@/hooks/useStorage');

const dayStr = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

const futurePage = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({
  id: `fw-${from + i}`,
  user_id: USER_ID,
  program_id: 'program-1',
  // Two workouts land on most dates, which is why `date` alone cannot order
  // the pages: the rows tied on it need a unique tiebreak.
  date: dayStr(Math.floor((from + i) / 2)),
  template_id: 'template-1',
  label: 'Push',
  completed: false,
  recovery_activities: null,
}));

const measurementPage = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({
  id: `bm-${from + i}`,
  user_id: USER_ID,
  date: dayStr(from + i),
  weight_kg: 80 + i / 100,
}));

/** The (from, to) of every page the hook asked this table for, in order. */
const rangesFor = (table: string) => chains
  .filter(c => c.table === table)
  .map(c => c.chain.find(s => s[0] === 'range')?.slice(1));

/** The columns this read ordered by, in the order they were applied. */
const orderColumnsFor = (chain: unknown[][]) => chain.filter(s => s[0] === 'order').map(s => s[1]);

beforeEach(() => {
  localStorage.clear();
  toastError.mockClear();
  pages = {};
  endless = {};
  chains = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useStorage paging', () => {
  it('reads a table bigger than one page to the end, in order', async () => {
    pages = {
      future_workouts: [
        { data: futurePage(0, 1000), error: null },
        { data: futurePage(1000, 1000), error: null },
        { data: futurePage(2000, 500), error: null },
      ],
      body_measurements: [
        { data: measurementPage(0, 1000), error: null },
        { data: measurementPage(1000, 200), error: null },
      ],
    };

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The whole plan, not the first page of it: before this, the server's
    // max-rows cap cut it at 1000 and the upcoming dates simply weren't there.
    expect(result.current.futureWorkouts).toHaveLength(2500);
    expect(result.current.futureWorkouts[0].id).toBe('fw-0');
    expect(result.current.futureWorkouts[2499].id).toBe('fw-2499');
    expect(result.current.bodyMeasurements).toHaveLength(1200);
    expect(result.current.bodyMeasurements[1199].id).toBe('bm-1199');
    expect(result.current.dataTrusted).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    // Pages are contiguous, and the loop stops on the short one rather than
    // asking for a fourth.
    expect(rangesFor('future_workouts')).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(rangesFor('body_measurements')).toEqual([[0, 999], [1000, 1999]]);

    // Each page is its own query, so they only line up under a total order.
    // `id` is the primary key and is applied last, after the columns that
    // decide what the list means; ordering is applied before the range.
    for (const { chain } of chains.filter(c => c.table === 'future_workouts')) {
      expect(orderColumnsFor(chain)).toEqual(['date', 'id']);
      const lastOrder = chain.map(s => s[0]).lastIndexOf('order');
      expect(chain.findIndex(s => s[0] === 'range')).toBeGreaterThan(lastOrder);
    }
    for (const { chain } of chains.filter(c => c.table === 'body_measurements')) {
      expect(orderColumnsFor(chain)).toEqual(['date', 'created_at', 'id']);
      const lastOrder = chain.map(s => s[0]).lastIndexOf('order');
      expect(chain.findIndex(s => s[0] === 'range')).toBeGreaterThan(lastOrder);
    }
  });

  it('fails the whole load when a page fails, rather than passing the pages so far off as the table', async () => {
    pages = {
      future_workouts: [
        { data: futurePage(0, 1000), error: null },
        { data: null, error: { code: '500', message: 'server error' } },
      ],
    };

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Not the 1000 rows of page one: a partial schedule read as complete is
    // what makes a plan look finished when it is not.
    expect(result.current.futureWorkouts).toEqual([]);
    expect(result.current.dataTrusted).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Failed to load your data');
    // Nothing that incomplete may become the next open's last-known-good.
    expect(readStorageCache(USER_ID)).toBeNull();
  });

  it('says so when a table is too big to finish reading instead of truncating in silence', async () => {
    endless = { future_workouts: { data: futurePage(0, 1000), error: null } };

    const { result } = renderHook(() => useStorage());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The loop is bounded, so a table that never answers short cannot spin.
    expect(rangesFor('future_workouts')).toHaveLength(20);
    expect(result.current.futureWorkouts).toHaveLength(20_000);
    expect(toastError).toHaveBeenCalledWith(
      "You have more scheduled workouts than one load can read — the furthest-out dates aren't shown.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('stopped after 20 pages'));
  });
});
