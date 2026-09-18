import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { readPendingTemplates, queuePendingTemplate } from '@/utils/pendingTemplateWrites';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram } from '@/types/workout';

const USER_ID = 'user-1';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Rows each table hands back, and how the next upsert should behave. */
const rows: Record<string, unknown[]> = {};
let upsertOutcome: 'ok' | 'error' | 'throw' = 'ok';
const upserts: { table: string; payload: unknown }[] = [];
/** Every chained call on every builder, in order: [table, method, ...args]. */
const chain: unknown[][] = [];

function makeBuilder(table: string) {
  // An insert echoes its rows back (with ids) from .select(); anything else
  // reads the table's seeded rows.
  let inserted: Record<string, unknown>[] | null = null;
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) => {
      const data = inserted ? inserted.map((r, i) => ({ id: `new-${i}`, created_at: '2026-09-18T12:00:00.000Z', ...r })) : (rows[table] ?? []);
      return Promise.resolve({ data, error: null }).then(...args);
    },
    upsert: (payload: unknown) => {
      upserts.push({ table, payload });
      if (upsertOutcome === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        upsertOutcome === 'error' ? { error: { message: 'network' } } : { error: null },
      );
    },
    insert: (payload: Record<string, unknown>[]) => { inserted = payload; chain.push([table, 'insert', payload.length]); return builder; },
  };
  for (const m of ['select', 'eq', 'order', 'range', 'maybeSingle', 'update', 'delete', 'gte', 'lte', 'lt', 'neq', 'or', 'not', 'in']) {
    builder[m] = (...args: unknown[]) => { chain.push([table, m, ...args]); return builder; };
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
  chain.length = 0;
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
