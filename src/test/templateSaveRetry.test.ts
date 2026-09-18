import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { readPendingTemplates, queuePendingTemplate, clearPendingTemplate } from '@/utils/pendingTemplateWrites';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram } from '@/types/workout';

const USER_ID = 'user-1';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Rows each table hands back, and how the next upsert should behave. */
const rows: Record<string, unknown[]> = {};
let upsertOutcome: 'ok' | 'error' | 'throw' = 'ok';
/** While set, every upsert sent is held until it resolves. */
let upsertGate: Promise<void> | null = null;
/** How a delete on a table answers; tables absent from it succeed. */
const deleteOutcome: Record<string, 'error' | 'throw'> = {};
const upserts: { table: string; payload: unknown }[] = [];
/** Writes in the order the server answered them: [table, op, payload]. */
const landed: [string, string, unknown][] = [];
/** Every chained call on every builder, in order: [table, method, ...args]. */
const chain: unknown[][] = [];

function makeBuilder(table: string) {
  // An insert echoes its rows back (with ids) from .select(); anything else
  // reads the table's seeded rows.
  let inserted: Record<string, unknown>[] | null = null;
  let op = 'select';
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) => {
      if (op === 'delete') {
        const outcome = deleteOutcome[table];
        if (outcome === 'throw') return Promise.reject(new TypeError('Failed to fetch')).then(...args);
        if (outcome === 'error') return Promise.resolve({ data: null, error: { message: 'refused' } }).then(...args);
        landed.push([table, 'delete', null]);
      }
      const data = inserted ? inserted.map((r, i) => ({ id: `new-${i}`, created_at: '2026-09-18T12:00:00.000Z', ...r })) : (rows[table] ?? []);
      return Promise.resolve({ data, error: null }).then(...args);
    },
    upsert: async (payload: unknown) => {
      upserts.push({ table, payload });
      if (upsertGate) await upsertGate;
      if (upsertOutcome === 'throw') throw new TypeError('Failed to fetch');
      if (upsertOutcome === 'ok') landed.push([table, 'upsert', payload]);
      return upsertOutcome === 'error' ? { error: { message: 'network' } } : { error: null };
    },
    insert: (payload: Record<string, unknown>[]) => { inserted = payload; chain.push([table, 'insert', payload.length]); return builder; },
  };
  for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle', 'update', 'delete', 'gte', 'lte', 'lt', 'neq', 'or', 'not', 'in']) {
    builder[m] = (...args: unknown[]) => { if (m === 'delete') op = m; chain.push([table, m, ...args]); return builder; };
  }
  return builder;
}

/** Hold every upsert until the returned function is called. */
function holdUpserts(): () => void {
  let release!: () => void;
  upsertGate = new Promise<void>(r => { release = r; });
  return () => { upsertGate = null; release(); };
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
  chain.length = 0;
  landed.length = 0;
  upsertOutcome = 'ok';
  upsertGate = null;
  for (const k of Object.keys(rows)) delete rows[k];
  for (const k of Object.keys(deleteOutcome)) delete deleteOutcome[k];
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

// The replay is older than anything the user does after reopening the app.
// Left unsynchronised, its upsert could land after — and silently replace —
// an edit made in the seconds the replay was in flight.
describe('a template write made while queued writes are replaying', () => {
  const templateWrites = () => landed.filter(([t]) => t === 'workout_templates');

  it('lands after the replayed write, so the older version can never replace it', async () => {
    queuePendingTemplate(USER_ID, tpl({ name: 'Queued offline' }));
    rows.workout_templates = [templateRow('Stale server copy')];
    const release = holdUpserts();
    const { result } = await mounted();
    await waitFor(() => expect(upserts.filter(u => u.table === 'workout_templates')).toHaveLength(1));

    let saved!: Promise<boolean>;
    act(() => { saved = result.current.saveTemplate(tpl({ name: 'Edited after reopening' })); });
    // Nothing goes out while the replay is in flight, but the edit is on screen.
    expect(upserts.filter(u => u.table === 'workout_templates')).toHaveLength(1);
    expect(result.current.templates.find(t => t.id === 'tpl-1')?.name).toBe('Edited after reopening');

    release();
    await act(async () => { expect(await saved).toBe(true); });

    expect(templateWrites().map(([, , p]) => (p as { name: string }).name)).toEqual(['Queued offline', 'Edited after reopening']);
    expect(readPendingTemplates(USER_ID)).toEqual([]);
    expect(result.current.templates.find(t => t.id === 'tpl-1')?.name).toBe('Edited after reopening');
  });

  it('does not let the replay resurrect a template deleted meanwhile', async () => {
    queuePendingTemplate(USER_ID, tpl({ name: 'Queued offline' }));
    rows.workout_templates = [templateRow('Stale server copy')];
    const release = holdUpserts();
    const { result } = await mounted();

    let deleted!: Promise<boolean>;
    act(() => { deleted = result.current.deleteTemplate('tpl-1'); });
    expect(templateWrites()).toEqual([]);

    release();
    await act(async () => { expect(await deleted).toBe(true); });

    expect(templateWrites().map(([, op]) => op)).toEqual(['upsert', 'delete']);
    expect(readPendingTemplates(USER_ID)).toEqual([]);
    expect(result.current.templates).toEqual([]);
  });

  it('skips a queued entry that was cleared while an earlier one was in flight', async () => {
    queuePendingTemplate(USER_ID, tpl({ id: 'tpl-1', name: 'First' }));
    queuePendingTemplate(USER_ID, tpl({ id: 'tpl-2', name: 'Second' }));
    const release = holdUpserts();
    await mounted();
    // Another tab got the second one through and cleared it.
    clearPendingTemplate(USER_ID, 'tpl-2');

    release();
    await waitFor(() => expect(templateWrites()).toHaveLength(1));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    expect(upserts.filter(u => u.table === 'workout_templates').map(u => (u.payload as { id: string }).id)).toEqual(['tpl-1']);
  });
});

describe('saveTemplate lists the template at once', () => {
  it('shows it before the server has answered, and only once after', async () => {
    const { result } = await mounted();
    const release = holdUpserts();

    let saved!: Promise<boolean>;
    act(() => { saved = result.current.saveTemplate(tpl({ id: 'copy-1', name: 'Push (2)' })); });
    // A list that lacked the copy until the round trip finished is what
    // invited a second tap on Duplicate.
    expect(result.current.templates.map(t => t.id)).toContain('copy-1');

    release();
    await act(async () => { expect(await saved).toBe(true); });
    expect(result.current.templates.filter(t => t.id === 'copy-1')).toHaveLength(1);
  });
});

describe('deleteTemplate', () => {
  it('resolves true once the row is gone', async () => {
    rows.workout_templates = [templateRow('Push')];
    const { result } = await mounted();
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteTemplate('tpl-1'); });

    expect(ok).toBe(true);
    expect(result.current.templates).toEqual([]);
  });

  it('resolves false and keeps the template when the server refuses', async () => {
    rows.workout_templates = [templateRow('Push')];
    const { result } = await mounted();
    deleteOutcome.workout_templates = 'error';
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteTemplate('tpl-1'); });

    expect(ok).toBe(false);
    expect(result.current.templates.map(t => t.id)).toEqual(['tpl-1']);
  });

  it('resolves false rather than throwing when the request never reaches the server', async () => {
    rows.workout_templates = [templateRow('Push')];
    const { result } = await mounted();
    deleteOutcome.workout_templates = 'throw';
    let ok: boolean | undefined;
    let threw = false;
    await act(async () => {
      try { ok = await result.current.deleteTemplate('tpl-1'); } catch { threw = true; }
    });

    expect(threw).toBe(false);
    expect(ok).toBe(false);
  });
});

describe('deleteProgram', () => {
  const programRow = { id: 'prog-1', user_id: USER_ID, name: 'PPL', days: [], duration_weeks: 8, start_date: null, schedule: null, created_at: '', updated_at: '' };
  const fwRow = (id: string, programId: string) => ({
    id, program_id: programId, user_id: USER_ID, date: '2099-01-01', template_id: 't', label: 'A',
    completed: false, recovery_activities: null, created_at: '', updated_at: '',
  });
  const deletes = () => landed.filter(([, op]) => op === 'delete').map(([t]) => t);

  it('resolves true and drops the program and its calendar, calendar first', async () => {
    rows.workout_programs = [programRow];
    rows.future_workouts = [fwRow('fw-1', 'prog-1'), fwRow('fw-2', 'prog-2')];
    const { result } = await mounted();
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteProgram('prog-1'); });

    expect(ok).toBe(true);
    expect(result.current.programs).toEqual([]);
    expect(result.current.futureWorkouts.map(fw => fw.id)).toEqual(['fw-2']);
    expect(deletes()).toEqual(['future_workouts', 'workout_programs']);
  });

  it('stops before the program row when its calendar rows cannot be deleted', async () => {
    rows.workout_programs = [programRow];
    rows.future_workouts = [fwRow('fw-1', 'prog-1')];
    const { result } = await mounted();
    deleteOutcome.future_workouts = 'error';
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteProgram('prog-1'); });

    expect(ok).toBe(false);
    expect(result.current.programs.map(p => p.id)).toEqual(['prog-1']);
    expect(result.current.futureWorkouts.map(fw => fw.id)).toEqual(['fw-1']);
    // A program deleted from under its calendar rows leaves ghosts that
    // reappear on every load; the program row is never touched here.
    expect(chain.some(c => c[0] === 'workout_programs' && c[1] === 'delete')).toBe(false);
  });

  it('resolves false and keeps the program when its row cannot be deleted', async () => {
    rows.workout_programs = [programRow];
    rows.future_workouts = [fwRow('fw-1', 'prog-1')];
    const { result } = await mounted();
    deleteOutcome.workout_programs = 'error';
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteProgram('prog-1'); });

    expect(ok).toBe(false);
    expect(result.current.programs.map(p => p.id)).toEqual(['prog-1']);
  });

  it('resolves false rather than throwing when the request never reaches the server', async () => {
    rows.workout_programs = [programRow];
    const { result } = await mounted();
    deleteOutcome.workout_programs = 'throw';
    let ok: boolean | undefined;
    let threw = false;
    await act(async () => {
      try { ok = await result.current.deleteProgram('prog-1'); } catch { threw = true; }
    });

    expect(threw).toBe(false);
    expect(ok).toBe(false);
  });

  it('clears the active program when it is the one deleted', async () => {
    rows.workout_programs = [programRow];
    const { result } = await mounted();
    await act(async () => { await result.current.setActiveProgram('prog-1'); });
    upserts.length = 0;

    await act(async () => { await result.current.deleteProgram('prog-1'); });

    // Settings and the coach's context would otherwise keep naming a
    // program that no longer exists.
    expect(result.current.activeProgramId).toBeNull();
    expect(upserts.find(u => u.table === 'user_settings')?.payload).toMatchObject({ active_program_id: null });
  });

  it('leaves the active program alone when another one is deleted', async () => {
    rows.workout_programs = [programRow, { ...programRow, id: 'prog-2' }];
    const { result } = await mounted();
    await act(async () => { await result.current.setActiveProgram('prog-2'); });
    upserts.length = 0;

    await act(async () => { await result.current.deleteProgram('prog-1'); });

    expect(result.current.activeProgramId).toBe('prog-2');
    expect(upserts.filter(u => u.table === 'user_settings')).toEqual([]);
  });
});

describe('scheduled workout writes report whether they landed', () => {
  const fwRow = { id: 'fw-1', program_id: 'prog-1', user_id: USER_ID, date: '2020-01-01', template_id: 't', label: 'A', completed: false, recovery_activities: null, created_at: '', updated_at: '' };

  it('deleteFutureWorkout resolves true once the row is gone', async () => {
    rows.future_workouts = [fwRow];
    const { result } = await mounted();
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteFutureWorkout('fw-1'); });

    expect(ok).toBe(true);
    expect(result.current.futureWorkouts).toEqual([]);
  });

  it('deleteFutureWorkout resolves false and keeps the row when the server refuses', async () => {
    rows.future_workouts = [fwRow];
    const { result } = await mounted();
    deleteOutcome.future_workouts = 'error';
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.deleteFutureWorkout('fw-1'); });

    expect(ok).toBe(false);
    expect(result.current.futureWorkouts.map(fw => fw.id)).toEqual(['fw-1']);
  });

  it('updateFutureWorkout resolves false and keeps the old row when the write fails', async () => {
    rows.future_workouts = [fwRow];
    const { result } = await mounted();
    upsertOutcome = 'error';
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.updateFutureWorkout({ id: 'fw-1', programId: 'prog-1', date: '2020-02-01', templateId: 't', label: 'A', completed: false });
    });

    expect(ok).toBe(false);
    expect(result.current.futureWorkouts[0].date).toBe('2020-01-01');
  });
});

describe('bodyweight history load', () => {
  it('breaks a same-day tie by when the entry was logged', async () => {
    await mounted();
    // Ordered by date alone, a reload could put the earlier of two same-day
    // entries first, and the profile and the coach would call it the latest.
    const orders = chain
      .filter(c => c[0] === 'body_measurements' && c[1] === 'order')
      .map(c => [c[2], (c[3] as { ascending: boolean }).ascending]);
    expect(orders).toEqual([['date', false], ['created_at', false]]);
  });
});

// A finished workout used to be lost outright when the upsert failed: the
// caller cleared the session cache and left the summary screen without waiting
// for a result, and saveSession reported nothing back. It now resolves a
// boolean so the caller can keep both copies alive for a retry.
describe('saveSession', () => {
  const session = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
    id: 'sess-1',
    date: '2026-09-15',
    exercises: [],
    duration: 1800,
    totalVolume: 1000,
    totalSets: 9,
    totalReps: 80,
    ...over,
  });

  it('reports success and keeps the workout once the row is written', async () => {
    const { result } = await mounted();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveSession(session()); });

    expect(saved).toBe(true);
    expect(upserts.filter(u => u.table === 'workout_sessions')).toHaveLength(1);
    expect(result.current.history.map(s => s.id)).toEqual(['sess-1']);
  });

  it('reports failure when the server rejects the write', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveSession(session()); });

    expect(saved).toBe(false);
    expect(result.current.history).toEqual([]);
  });

  it('reports failure rather than throwing when the request never reaches the server', async () => {
    const { result } = await mounted();
    upsertOutcome = 'throw';
    let saved: boolean | undefined;
    let threw = false;
    await act(async () => {
      try {
        saved = await result.current.saveSession(session());
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    expect(saved).toBe(false);
    expect(result.current.history).toEqual([]);
  });
});

describe('saveProgram', () => {
  // Zero weeks schedules nothing, which keeps the test on the row write itself
  // rather than the calendar regeneration that follows it.
  const program = (over: Partial<WorkoutProgram> = {}): WorkoutProgram => ({
    id: 'prog-1', name: 'Push/Pull', days: [], durationWeeks: 0, ...over,
  });

  it('resolves true and keeps the program once the row is written', async () => {
    const { result } = await mounted();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveProgram(program()); });

    expect(saved).toBe(true);
    expect(upserts.filter(u => u.table === 'workout_programs')).toHaveLength(1);
    expect(result.current.programs.map(p => p.id)).toEqual(['prog-1']);
  });

  it('resolves false when the server rejects the write, so the builder keeps its draft', async () => {
    const { result } = await mounted();
    upsertOutcome = 'error';
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveProgram(program()); });

    expect(saved).toBe(false);
    expect(result.current.programs).toEqual([]);
  });

  it('resolves false rather than throwing when the request never reaches the server', async () => {
    const { result } = await mounted();
    upsertOutcome = 'throw';
    let saved: boolean | undefined;
    let threw = false;
    await act(async () => {
      try { saved = await result.current.saveProgram(program()); } catch { threw = true; }
    });

    expect(threw).toBe(false);
    expect(saved).toBe(false);
  });
});

describe('setActiveProgram', () => {
  it('rolls the active id back and reports failure when the settings write fails', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.setActiveProgram('prog-old'); });
    expect(result.current.activeProgramId).toBe('prog-old');

    upsertOutcome = 'error';
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.setActiveProgram('prog-new'); });

    expect(ok).toBe(false);
    // The optimistic value must not survive a failed write: the coach and the
    // dashboard would otherwise show a program the server never recorded.
    expect(result.current.activeProgramId).toBe('prog-old');
  });
});

describe('saveProgram regenerates the calendar without erasing history', () => {
  const today = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('keeps completed and past rows, inserts the new ones first, and retires only upcoming uncompleted rows', async () => {
    rows['future_workouts'] = [
      { id: 'done-1', program_id: 'prog-1', user_id: 'u1', date: '2026-01-05', template_id: 't', label: 'A', completed: true, recovery_activities: null, created_at: '', updated_at: '' },
      { id: 'other-prog', program_id: 'prog-2', user_id: 'u1', date: '2099-01-01', template_id: 't', label: 'B', completed: false, recovery_activities: null, created_at: '', updated_at: '' },
    ];
    const { result } = await mounted();
    chain.length = 0;

    const program: WorkoutProgram = {
      id: 'prog-1', name: 'Weekly', durationWeeks: 1, startDate: ymd(today),
      days: [{ label: 'A', templateId: 't', frequency: { type: 'weekly', weekday: today.getDay() } }],
    };
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.saveProgram(program); });
    expect(ok).toBe(true);

    // The completed past row and the other program's row survive; the new
    // rows are present.
    const ids = result.current.futureWorkouts.map(fw => fw.id);
    expect(ids).toContain('done-1');
    expect(ids).toContain('other-prog');
    expect(ids.some(id => id.startsWith('new-'))).toBe(true);

    // Insert happened before the delete, and the delete was scoped.
    const order = chain.filter(c => c[0] === 'future_workouts').map(c => c[1]);
    expect(order.indexOf('insert')).toBeLessThan(order.indexOf('delete'));
    const afterDelete = chain.slice(chain.findIndex(c => c[0] === 'future_workouts' && c[1] === 'delete'));
    expect(afterDelete.some(c => c[1] === 'gte' && c[2] === 'date' && c[3] === ymd(today))).toBe(true);
    expect(afterDelete.some(c => c[1] === 'or' && String(c[2]).includes('completed.eq.false'))).toBe(true);
    // Retired by the server's own timestamp on the rows just written, never
    // by a list of their ids: that list grew with the program until the URL
    // was refused, and a refused delete doubled every date.
    expect(afterDelete.some(c => c[1] === 'lt' && c[2] === 'created_at' && c[3] === '2026-09-18T12:00:00.000Z')).toBe(true);
    expect(afterDelete.some(c => c[1] === 'not')).toBe(false);
  });

  it('drops the superseded upcoming rows from state and does not schedule a workout beside its completed row', async () => {
    const todayStr = ymd(today);
    rows['future_workouts'] = [
      // Today's workout, already done: it survives, and the regenerated
      // schedule must not put a second copy of the same workout beside it.
      { id: 'done-today', program_id: 'prog-1', user_id: 'u1', date: todayStr, template_id: 't', label: 'A', completed: true, recovery_activities: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '' },
      // An upcoming row of the old schedule: retired.
      { id: 'stale-upcoming', program_id: 'prog-1', user_id: 'u1', date: '2099-01-01', template_id: 't', label: 'A', completed: false, recovery_activities: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '' },
      // A past row never done: history, kept.
      { id: 'past-missed', program_id: 'prog-1', user_id: 'u1', date: '2026-01-05', template_id: 't', label: 'A', completed: false, recovery_activities: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '' },
    ];
    const { result } = await mounted();
    chain.length = 0;

    const program: WorkoutProgram = {
      id: 'prog-1', name: 'Weekly', durationWeeks: 1, startDate: todayStr,
      days: [{ label: 'A', templateId: 't', frequency: { type: 'weekly', weekday: today.getDay() } }],
    };
    await act(async () => { await result.current.saveProgram(program); });

    const fws = result.current.futureWorkouts;
    const ids = fws.map(fw => fw.id);
    expect(ids).toContain('done-today');
    expect(ids).toContain('past-missed');
    expect(ids).not.toContain('stale-upcoming');
    expect(fws.filter(fw => fw.date === todayStr && fw.templateId === 't')).toHaveLength(1);
    // The rest days around it were still written.
    expect(fws.filter(fw => fw.date === todayStr && fw.templateId === 'rest')).toHaveLength(0);
    expect(fws.some(fw => fw.id.startsWith('new-') && fw.templateId === 'rest')).toBe(true);
    const insertedRows = chain.find(c => c[0] === 'future_workouts' && c[1] === 'insert');
    expect(insertedRows).toBeDefined();
  });
});

describe('updatePreferences sends only what changed', () => {
  it('writes the changed column and the user id, nothing else', async () => {
    const { result } = await mounted();
    upserts.length = 0;

    await act(async () => { await result.current.updatePreferences({ weightUnit: 'kg' }); });

    const write = upserts.find(u => u.table === 'user_settings');
    expect(write).toBeTruthy();
    // A whole-row write here is what let one device revert another's newer
    // settings, and what dragged active_program_id along on every save.
    expect(Object.keys(write!.payload as object).sort()).toEqual(['user_id', 'weight_unit']);
  });

  it('carries the streak adjustment along when the mode changes, since it is derived from it', async () => {
    const { result } = await mounted();
    upserts.length = 0;

    await act(async () => { await result.current.updatePreferences({ streakMode: 'weekly' }); });

    const keys = Object.keys(upserts.find(u => u.table === 'user_settings')!.payload as object).sort();
    expect(keys).toEqual(['streak_adjustment', 'streak_adjustment_set_at', 'streak_mode', 'user_id']);
  });
});
