import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { readPendingTemplates, queuePendingTemplate } from '@/utils/pendingTemplateWrites';
import type { WorkoutTemplate } from '@/types/workout';

const USER_ID = 'user-1';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Rows each table hands back, and how the next upsert should behave. */
const rows: Record<string, unknown[]> = {};
let upsertOutcome: 'ok' | 'error' | 'throw' = 'ok';
const upserts: { table: string; payload: unknown }[] = [];

function makeBuilder(table: string) {
  const result = Promise.resolve({ data: rows[table] ?? [], error: null });
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    upsert: (payload: unknown) => {
      upserts.push({ table, payload });
      if (upsertOutcome === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        upsertOutcome === 'error' ? { error: { message: 'network' } } : { error: null },
      );
    },
  };
  for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle', 'update', 'delete']) {
    builder[m] = () => builder;
  }
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

const { useStorage } = await import('@/hooks/useStorage');

const tpl = (over: Partial<WorkoutTemplate> = {}): WorkoutTemplate => ({
  id: 'tpl-1',
  name: 'Push',
  exercises: [{ exerciseId: 'flat-barbell-bench-press', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }],
  ...over,
});

const templateRow = (name: string) => ({ id: 'tpl-1', name, exercises: [] });

beforeEach(() => {
  localStorage.clear();
  upserts.length = 0;
  upsertOutcome = 'ok';
  for (const k of Object.keys(rows)) delete rows[k];
  vi.clearAllMocks();
});

async function mounted() {
  const hook = renderHook(() => useStorage());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('saveTemplate', () => {
  it('reports success once the row is written', async () => {
    const { result } = await mounted();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveTemplate(tpl()); });

    expect(saved).toBe(true);
    expect(upserts.filter(u => u.table === 'workout_templates')).toHaveLength(1);
    expect(result.current.templates.find(t => t.id === 'tpl-1')?.exercises).toHaveLength(1);
  });

  it('reports failure instead of a silent no-op', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveTemplate(tpl()); });

    expect(saved).toBe(false);
  });

  it('survives an offline fetch that rejects rather than returning an error', async () => {
    const { result } = await mounted();
    upsertOutcome = 'throw';
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveTemplate(tpl()); });

    expect(saved).toBe(false);
  });

  it('keeps the edit on screen when the write fails', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    await act(async () => { await result.current.saveTemplate(tpl({ name: 'Push (updated)' })); });

    expect(result.current.templates.find(t => t.id === 'tpl-1')?.name).toBe('Push (updated)');
  });

  it('queues a failed write so it can be retried later', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    await act(async () => { await result.current.saveTemplate(tpl({ name: 'Push (updated)' })); });

    const pending = readPendingTemplates(USER_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].template.name).toBe('Push (updated)');
  });

  it('leaves nothing queued when the write lands', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.saveTemplate(tpl()); });
    expect(readPendingTemplates(USER_ID)).toEqual([]);
  });

  it('clears an earlier queued write once a later one succeeds', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    await act(async () => { await result.current.saveTemplate(tpl({ name: 'Attempt 1' })); });
    upsertOutcome = 'ok';
    await act(async () => { await result.current.saveTemplate(tpl({ name: 'Attempt 2' })); });

    expect(readPendingTemplates(USER_ID)).toEqual([]);
  });
});

describe('pending writes on the next load', () => {
  it('replays a write that never reached the server', async () => {
    queuePendingTemplate(USER_ID, tpl({ name: 'Saved at the gym' }));
    rows.workout_templates = [templateRow('Stale server copy')];

    const { result } = await mounted();

    await waitFor(() => expect(readPendingTemplates(USER_ID)).toEqual([]));
    expect(upserts.filter(u => u.table === 'workout_templates')).toHaveLength(1);
    expect(result.current.templates.find(t => t.id === 'tpl-1')?.name).toBe('Saved at the gym');
  });

  it('shows the queued version rather than the stale row it replaces', async () => {
    queuePendingTemplate(USER_ID, tpl({ name: 'Saved at the gym' }));
    rows.workout_templates = [templateRow('Stale server copy')];

    const { result } = await mounted();

    expect(result.current.templates.map(t => t.name)).toEqual(['Saved at the gym']);
  });

  it('keeps the write queued when the replay also fails', async () => {
    queuePendingTemplate(USER_ID, tpl({ name: 'Saved at the gym' }));
    rows.workout_templates = [templateRow('Stale server copy')];
    upsertOutcome = 'error';

    await mounted();

    await waitFor(() => expect(upserts.filter(u => u.table === 'workout_templates')).toHaveLength(1));
    expect(readPendingTemplates(USER_ID)).toHaveLength(1);
  });

  it('does not resurrect a template that was deleted after the write was queued', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    await act(async () => { await result.current.saveTemplate(tpl()); });
    upsertOutcome = 'ok';
    await act(async () => { await result.current.deleteTemplate('tpl-1'); });

    expect(readPendingTemplates(USER_ID)).toEqual([]);
    expect(result.current.templates.find(t => t.id === 'tpl-1')).toBeUndefined();
  });

  it('does not upsert anything when there is nothing queued', async () => {
    rows.workout_templates = [templateRow('Push')];
    await mounted();
    expect(upserts.filter(u => u.table === 'workout_templates')).toHaveLength(0);
  });
});
