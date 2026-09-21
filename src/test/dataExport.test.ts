import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exportUserData } from '@/utils/dataPortability';

type Answer = { data: unknown; error: unknown };

/**
 * Paged reads answer from `pages[table]` in order; single-row reads from
 * `single[table]`. Tables absent from both come back empty.
 */
function stubClient(opts: { pages?: Record<string, Answer[]>; single?: Record<string, Answer> }) {
  const calls: { table: string; chain: unknown[][] }[] = [];
  const client = {
    from: (table: string) => {
      const chain: unknown[][] = [];
      calls.push({ table, chain });
      const builder: Record<string, unknown> = {
        then: (...args: Parameters<Promise<unknown>['then']>) => {
          const isSingle = chain.some(c => c[0] === 'maybeSingle');
          const answer: Answer = isSingle
            ? (opts.single?.[table] ?? { data: null, error: null })
            : (opts.pages?.[table]?.shift() ?? { data: [], error: null });
          return Promise.resolve(answer).then(...args);
        },
      };
      for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle']) {
        builder[m] = (...args: unknown[]) => { chain.push([m, ...args]); return builder; };
      }
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const rowsNumbered = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${from + i}` }));

const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

let downloaded: Blob | null;

beforeEach(() => {
  downloaded = null;
  // jsdom has neither object URLs nor navigation; capture the file instead.
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => { downloaded = blob; return 'blob:backup'; }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('exportUserData', () => {
  it('walks a large table page by page under a total order, so pages neither overlap nor skip', async () => {
    const { client, calls } = stubClient({
      pages: {
        workout_sessions: [
          { data: rowsNumbered(0, 1000), error: null },
          { data: rowsNumbered(1000, 1000), error: null },
          { data: rowsNumbered(2000, 3), error: null },
        ],
      },
    });

    await exportUserData(client, 'me');

    const sessionReads = calls.filter(c => c.table === 'workout_sessions');
    expect(sessionReads.map(c => c.chain.find(s => s[0] === 'range')?.slice(1))).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    // Without an ORDER BY, Postgres is free to answer each page from a
    // different row order, and a backup past one page came back with rows
    // doubled or missing.
    for (const read of sessionReads) {
      const order = read.chain.findIndex(s => s[0] === 'order');
      const range = read.chain.findIndex(s => s[0] === 'range');
      expect(read.chain[order]).toEqual(['order', 'id', { ascending: true }]);
      expect(order).toBeLessThan(range);
    }

    expect(downloaded).not.toBeNull();
    const backup = JSON.parse(await readBlob(downloaded!));
    expect(backup.data.workout_sessions).toHaveLength(2003);
  });

  it('fails instead of writing a backup whose settings section is silently empty', async () => {
    const { client } = stubClient({ single: { user_settings: { data: null, error: { message: 'timeout' } } } });

    await expect(exportUserData(client, 'me')).rejects.toBeTruthy();
    expect(downloaded).toBeNull();
  });

  it('fails instead of writing a backup whose profile section is silently empty', async () => {
    const { client } = stubClient({ single: { profiles: { data: null, error: { message: 'timeout' } } } });

    await expect(exportUserData(client, 'me')).rejects.toBeTruthy();
    expect(downloaded).toBeNull();
  });

  it('fails instead of writing a backup with the bodyweight history silently missing', async () => {
    const { client } = stubClient({ pages: { body_measurements: [{ data: null, error: { message: 'timeout' } }] } });

    await expect(exportUserData(client, 'me')).rejects.toBeTruthy();
    expect(downloaded).toBeNull();
  });

  it('includes the settings and profile rows when every read succeeds', async () => {
    const { client } = stubClient({
      single: {
        user_settings: { data: { user_id: 'me', weight_unit: 'kg' }, error: null },
        profiles: { data: { user_id: 'me', display_name: 'J' }, error: null },
      },
    });

    await exportUserData(client, 'me');

    const backup = JSON.parse(await readBlob(downloaded!));
    expect(backup.data.user_settings).toEqual({ user_id: 'me', weight_unit: 'kg' });
    expect(backup.data.profile).toEqual({ user_id: 'me', display_name: 'J' });
  });
});
