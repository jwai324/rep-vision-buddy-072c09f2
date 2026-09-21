import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TemplateSnapshot } from '@/types/share';

/**
 * Publishing and revoking are the two writes behind a URL that has already
 * been sent to someone. Both have a failure mode that reads as success if the
 * hook does not check: a republish that silently does nothing still hands back
 * the old token, and a revoke that the server refuses still leaves the link
 * live while the screen says otherwise.
 *
 * The supabase client is faked as a small table that actually holds rows, so
 * "the list reflects it" is an assertion about the list the hook re-reads, not
 * about the call it made.
 */

interface Row {
  id: string;
  token: string;
  user_id: string;
  kind: string;
  source_id: string | null;
  title: string;
  payload: unknown;
  revoked_at: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

type Failure = { code?: string; message?: string } | null;

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  seq: 0,
  inserts: 0,
  fail: {} as { lookup?: unknown; insert?: unknown; update?: unknown; list?: unknown },
}));

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'sharer' } }),
}));

vi.mock('@/integrations/supabase/client', () => {
  type Filter = { op: 'eq' | 'is'; col: string; val?: unknown };

  const project = (row: Record<string, unknown>, columns: string) =>
    Object.fromEntries(columns.split(',').map(c => c.trim()).map(c => [c, row[c]]));

  const matches = (row: Record<string, unknown>, filters: Filter[]) =>
    filters.every(f => (f.op === 'eq' ? row[f.col] === f.val : row[f.col] === null));

  const rows = () => db.rows as Record<string, unknown>[];

  const select = (columns: string) => {
    const filters: Filter[] = [];
    let descending = false;
    const found = () => {
      const hits = rows().filter(r => matches(r, filters));
      return descending
        ? [...hits].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        : hits;
    };
    const q = {
      eq: (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return q; },
      is: (col: string) => { filters.push({ op: 'is', col }); return q; },
      order: (_col: string, opts?: { ascending?: boolean }) => { descending = opts?.ascending === false; return q; },
      maybeSingle: async () => {
        if (db.fail.lookup) return { data: null, error: db.fail.lookup };
        const hit = found()[0];
        return { data: hit ? project(hit, columns) : null, error: null };
      },
      // The list read is awaited directly off the builder.
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(
          db.fail.list
            ? { data: null, error: db.fail.list }
            : { data: found().map(r => project(r, columns)), error: null },
        ).then(onOk, onErr),
    };
    return q;
  };

  const update = (patch: Record<string, unknown>) => {
    const filters: Filter[] = [];
    const q = {
      eq: (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return q; },
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(null).then(() => {
          if (db.fail.update) return { data: null, error: db.fail.update };
          for (const row of rows()) {
            if (matches(row, filters)) Object.assign(row, patch, { updated_at: `2026-09-21T10:00:0${db.seq}.000Z` });
          }
          return { data: null, error: null };
        }).then(onOk, onErr),
    };
    return q;
  };

  const insert = (row: Record<string, unknown>) => ({
    select: (columns: string) => ({
      single: async () => {
        db.inserts += 1;
        if (db.fail.insert) return { data: null, error: db.fail.insert };
        db.seq += 1;
        const stamp = `2026-09-2${db.seq}T00:00:00.000Z`;
        const full: Row = {
          id: `share-${db.seq}`,
          token: `tok-${db.seq}`,
          revoked_at: null,
          view_count: 0,
          created_at: stamp,
          updated_at: stamp,
          ...(row as unknown as Row),
        };
        db.rows.push(full);
        return { data: project(full as unknown as Record<string, unknown>, columns), error: null };
      },
    }),
  });

  return { supabase: { from: () => ({ select, update, insert }) } };
});

import { useShares } from '@/hooks/useShares';

const snapshot = (name = 'Push'): TemplateSnapshot => ({
  version: 1, sharedAt: '2026-09-20T00:00:00.000Z', weightUnit: 'kg',
  sharedBy: null, customExercises: [],
  kind: 'template', template: { id: 'tpl-1', name, exercises: [] }, exerciseMeta: [],
});

const stored = () => db.rows as unknown as Row[];

/** The hook with its list loaded, the way the Shared Links screen mounts it. */
async function mountWithList() {
  const hook = renderHook(() => useShares());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const publish = async (
  result: { current: ReturnType<typeof useShares> },
  args: { title?: string; sourceId?: string; payload?: TemplateSnapshot } = {},
) => {
  let token: string | null = null;
  await act(async () => {
    token = await result.current.createOrUpdateShare({
      kind: 'template',
      sourceId: args.sourceId ?? 'tpl-1',
      title: args.title ?? 'Push',
      payload: args.payload ?? snapshot(),
    });
  });
  return token as string | null;
};

const failWith: Failure = { code: 'PGRST000', message: 'network' };

beforeEach(() => {
  db.rows = [];
  db.seq = 0;
  db.inserts = 0;
  db.fail = {};
  mocks.toastError.mockClear();
  mocks.toastSuccess.mockClear();
});

describe('useShares — publishing', () => {
  it('inserts the snapshot and the list picks the new link up', async () => {
    const { result } = await mountWithList();
    expect(result.current.shares).toHaveLength(0);

    const token = await publish(result, { title: 'Push Day' });

    expect(token).toBe('tok-1');
    await waitFor(() => expect(result.current.shares).toHaveLength(1));
    expect(result.current.shares[0]).toMatchObject({
      token: 'tok-1', kind: 'template', title: 'Push Day', sourceId: 'tpl-1', revokedAt: null,
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('republishes into the live row so the URL already sent keeps working', async () => {
    const { result } = await mountWithList();
    const first = await publish(result, { title: 'Push Day' });

    const again = await publish(result, { title: 'Push Day v2', payload: snapshot('Push v2') });

    expect(again).toBe(first);
    expect(db.inserts).toBe(1);
    expect(stored()).toHaveLength(1);
    expect(stored()[0].title).toBe('Push Day v2');
    expect((stored()[0].payload as TemplateSnapshot).template.name).toBe('Push v2');
    await waitFor(() => expect(result.current.shares[0].title).toBe('Push Day v2'));
  });

  it('reports a failed insert instead of handing back a link that does not exist', async () => {
    const { result } = await mountWithList();
    db.fail.insert = failWith;

    expect(await publish(result)).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith('Could not create a link');
    expect(stored()).toHaveLength(0);
    expect(result.current.shares).toHaveLength(0);
  });

  it('reports a failed republish rather than returning the old token as if it had updated', async () => {
    const { result } = await mountWithList();
    const first = await publish(result, { title: 'Push Day' });
    db.fail.update = failWith;

    const again = await publish(result, { title: 'Push Day v2', payload: snapshot('Push v2') });

    expect(again).toBeNull();
    expect(again).not.toBe(first);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not update the link');
    // The old snapshot is still what the live link serves.
    expect((stored()[0].payload as TemplateSnapshot).template.name).toBe('Push');
  });

  it('does not insert a duplicate when the "is there already one?" lookup fails', async () => {
    const { result } = await mountWithList();
    db.fail.lookup = failWith;

    expect(await publish(result)).toBeNull();
    expect(db.inserts).toBe(0);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not create a link');
  });

  it('refuses an oversized payload before it ever reaches the table', async () => {
    const { result } = await mountWithList();
    const huge = snapshot('x'.repeat(1_000_001));

    expect(await publish(result, { payload: huge })).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith('This is too large to share.');
    expect(db.inserts).toBe(0);
    expect(stored()).toHaveLength(0);
  });
});

describe('useShares — revoking', () => {
  const revoke = async (result: { current: ReturnType<typeof useShares> }, id: string) => {
    let ok = false;
    await act(async () => { ok = await result.current.revokeShare(id); });
    return ok;
  };

  it('stamps revoked_at and the list comes back showing the link as revoked', async () => {
    const { result } = await mountWithList();
    await publish(result);
    await waitFor(() => expect(result.current.shares).toHaveLength(1));

    expect(await revoke(result, result.current.shares[0].id)).toBe(true);

    expect(stored()[0].revoked_at).toEqual(expect.any(String));
    await waitFor(() => expect(result.current.shares[0].revokedAt).toEqual(expect.any(String)));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Link revoked');
  });

  it('says so when the revoke does not land, and the link stays live', async () => {
    const { result } = await mountWithList();
    await publish(result);
    await waitFor(() => expect(result.current.shares).toHaveLength(1));
    db.fail.update = failWith;

    expect(await revoke(result, result.current.shares[0].id)).toBe(false);

    expect(mocks.toastError).toHaveBeenCalledWith('Could not revoke the link');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(stored()[0].revoked_at).toBeNull();
    expect(result.current.shares[0].revokedAt).toBeNull();
  });

  it('frees the source to be shared again under a new token', async () => {
    const { result } = await mountWithList();
    const first = await publish(result);
    await waitFor(() => expect(result.current.shares).toHaveLength(1));
    await revoke(result, result.current.shares[0].id);

    await act(async () => {
      expect(await result.current.findLiveShare('template', 'tpl-1')).toBeNull();
    });

    const second = await publish(result);
    expect(second).toBe('tok-2');
    expect(second).not.toBe(first);
    expect(stored()).toHaveLength(2);
    await waitFor(() => expect(result.current.shares).toHaveLength(2));
  });
});
