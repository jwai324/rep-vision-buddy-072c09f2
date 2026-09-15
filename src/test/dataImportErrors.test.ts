import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importUserData, type RepVisionBackup } from '@/utils/dataPortability';

type UpsertCall = { table: string; rows: unknown };

/**
 * postgrest-js never rejects: a 42501 from RLS, a CHECK violation and an
 * offline fetch all come back as a resolved `{ data: null, error }`. The
 * importer used to read none of them and report success over an account
 * where nothing had landed.
 */
function stubClient(failOn: (table: string) => { code: string; message: string } | null) {
  const calls: UpsertCall[] = [];
  const client = {
    from: (table: string) => ({
      upsert: (rows: unknown) => {
        calls.push({ table, rows });
        return Promise.resolve({ data: null, error: failOn(table) });
      },
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const backup = (): RepVisionBackup => ({
  version: 2,
  exportedAt: '2026-09-01T00:00:00.000Z',
  data: {
    workout_sessions: [{ id: 's1', user_id: 'other', date: '2026-08-01' }],
    workout_templates: [{ id: 't1', user_id: 'other', name: 'Push' }],
    workout_programs: [],
    future_workouts: [],
    custom_exercises: [],
    body_measurements: [],
    user_settings: { id: 'x', user_id: 'other', weight_unit: 'kg' },
    profile: null,
  },
});

describe('importUserData', () => {
  it('reports failure rather than success when every write is rejected', async () => {
    const { client } = stubClient(() => ({ code: '42501', message: 'row-level security' }));

    const result = await importUserData(client, 'me', backup());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/user_settings/);
    // The 42501 case is a cross-account restore, which is the documented
    // reason the exporter exists — say so rather than echoing the SQL code.
    expect(result.error).toMatch(/exported from/);
  });

  it('stops at the first failing table and names what already landed', async () => {
    const { client, calls } = stubClient(table =>
      table === 'workout_sessions' ? { code: '23514', message: 'check violation' } : null,
    );

    const result = await importUserData(client, 'me', backup());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/workout_sessions/);
    expect(result.error).toMatch(/workout_templates 1/);
    expect(result.imported).toEqual({ user_settings: 1, workout_templates: 1 });
    // Nothing is attempted after the failure.
    expect(calls.map(c => c.table)).toEqual(['user_settings', 'workout_templates', 'workout_sessions']);
  });

  it('batches each table into one request and reports per-table counts', async () => {
    const { client, calls } = stubClient(() => null);

    const result = await importUserData(client, 'me', backup());

    expect(result.success).toBe(true);
    expect(result.imported).toEqual({ user_settings: 1, workout_templates: 1, workout_sessions: 1 });
    // One request per non-empty table, not one per row.
    expect(calls).toHaveLength(3);
    expect(Array.isArray(calls[1].rows)).toBe(true);
  });

  it('stamps the importing user onto every row', async () => {
    const { client, calls } = stubClient(() => null);

    await importUserData(client, 'me', backup());

    for (const call of calls) {
      const rows = call.rows as Array<Record<string, unknown>>;
      for (const row of rows) expect(row.user_id).toBe('me');
    }
  });
});
