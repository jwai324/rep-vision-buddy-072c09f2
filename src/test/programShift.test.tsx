import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';

const USER_ID = 'user-shift';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID }, session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Rows each table hands back on load. */
const rows: Record<string, unknown[]> = {};
/** How the next rpc call answers; the RPC returns the number of rows it moved. */
let rpcAnswer: () => Promise<{ data: number | null; error: unknown }> = async () => ({ data: 0, error: null });
const rpc = vi.fn((_name: string, _args: unknown) => rpcAnswer());

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {
    then: (...args: Parameters<Promise<unknown>['then']>) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(...args),
  };
  // Every filter the load-time program repair chains (it re-saves a program
  // whose days sanitize differently, which the malformed-anchor case triggers).
  for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'or', 'not', 'is', 'in', 'limit', 'order', 'range', 'maybeSingle', 'single', 'update', 'delete', 'upsert', 'insert']) {
    builder[m] = () => builder;
  }
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: (name: string, args: unknown) => rpc(name, args),
  },
}));

const { useStorage } = await import('@/hooks/useStorage');

const programDays = (anchor: string) => [
  { label: 'Push', templateId: 't-push', frequency: { type: 'weekly', weekday: 1 } },
  { label: 'Run', templateId: 't-run', frequency: { type: 'everyNDays', interval: 3, startDate: anchor } },
];

const programRow = (start_date: string | null) => ({
  id: 'prog-1', user_id: USER_ID, name: 'PPL', days: programDays('2026-09-01'),
  duration_weeks: 8, start_date, schedule: null, created_at: '', updated_at: '',
});

const fwRow = (id: string, date: string, over: { completed?: boolean; program_id?: string } = {}) => ({
  id, program_id: 'prog-1', user_id: USER_ID, date, template_id: 't-push', label: 'Push',
  completed: false, recovery_activities: null, created_at: '', updated_at: '', ...over,
});

const FROM = '2026-09-15';

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(rows)) delete rows[k];
  rows.workout_programs = [programRow('2026-09-01')];
  rows.future_workouts = [
    fwRow('fw-before', '2026-09-10'),
    fwRow('fw-a', FROM),
    fwRow('fw-done', '2026-09-16', { completed: true }),
    fwRow('fw-other', '2026-09-18', { program_id: 'prog-2' }),
    fwRow('fw-b', '2026-09-20'),
  ];
  rpcAnswer = async () => ({ data: 0, error: null });
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function mounted() {
  const hook = renderHook(() => useStorage());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const dateOf = (list: { id: string; date: string }[], id: string) => list.find(fw => fw.id === id)?.date;

describe('pushProgramBack', () => {
  it('shifts rows and program dates through one RPC and shows the server count', async () => {
    const { result } = await mounted();
    // Three moved on the server while the local list holds two of them: the
    // toast reports what actually moved.
    rpcAnswer = async () => ({ data: 3, error: null });

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 2); });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('shift_program_workouts', {
      p_program_id: 'prog-1',
      p_from_date: FROM,
      p_days: 2,
      p_start_date: '2026-09-03',
      p_program_days: programDays('2026-09-03'),
    });

    const list = result.current.futureWorkouts;
    expect(dateOf(list, 'fw-a')).toBe('2026-09-17');
    expect(dateOf(list, 'fw-b')).toBe('2026-09-22');
    expect(dateOf(list, 'fw-before')).toBe('2026-09-10');
    expect(dateOf(list, 'fw-done')).toBe('2026-09-16');
    expect(dateOf(list, 'fw-other')).toBe('2026-09-18');
    expect(list.map(fw => fw.date)).toEqual([...list.map(fw => fw.date)].sort());

    const program = result.current.programs.find(p => p.id === 'prog-1');
    expect(program?.startDate).toBe('2026-09-03');
    expect(program?.days).toEqual(programDays('2026-09-03'));
    expect(toast.success).toHaveBeenCalledWith('Shifted 3 workouts forward by 2 days');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('changes nothing locally when the RPC answers with an error', async () => {
    const { result } = await mounted();
    rpcAnswer = async () => ({ data: null, error: { message: 'program not found' } });

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 2); });

    expect(toast.error).toHaveBeenCalledWith('Failed to shift program dates');
    expect(toast.success).not.toHaveBeenCalled();
    expect(dateOf(result.current.futureWorkouts, 'fw-a')).toBe(FROM);
    expect(dateOf(result.current.futureWorkouts, 'fw-b')).toBe('2026-09-20');
    expect(result.current.programs.find(p => p.id === 'prog-1')?.startDate).toBe('2026-09-01');
  });

  it('changes nothing locally when the fetch rejects', async () => {
    const { result } = await mounted();
    rpcAnswer = () => Promise.reject(new TypeError('Failed to fetch'));

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 2); });

    expect(toast.error).toHaveBeenCalledWith('Failed to shift program dates');
    expect(toast.success).not.toHaveBeenCalled();
    expect(dateOf(result.current.futureWorkouts, 'fw-a')).toBe(FROM);
    expect(result.current.programs.find(p => p.id === 'prog-1')?.startDate).toBe('2026-09-01');
  });

  it('never sends a shift the function would reject', async () => {
    const { result } = await mounted();

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 0); });
    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 400); });

    expect(rpc).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Shift by 1 to 366 days');
    expect(dateOf(result.current.futureWorkouts, 'fw-a')).toBe(FROM);
  });

  it('runs one shift at a time', async () => {
    const { result } = await mounted();
    let release!: () => void;
    rpcAnswer = () => new Promise<void>(r => { release = r; }).then(() => ({ data: 2, error: null }));

    // A double tap: the second call lands while the first is still waiting on
    // the server, and the function would shift the calendar twice.
    await act(async () => {
      const first = result.current.pushProgramBack('prog-1', FROM, 2);
      const second = result.current.pushProgramBack('prog-1', FROM, 2);
      await second;
      expect(rpc).toHaveBeenCalledTimes(1);
      release();
      await first;
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(dateOf(result.current.futureWorkouts, 'fw-a')).toBe('2026-09-17');

    // Once the first has answered, the next tap is a new shift.
    rpcAnswer = async () => ({ data: 2, error: null });
    await act(async () => { await result.current.pushProgramBack('prog-1', '2026-09-17', 1); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('leaves a row whose date is not a real day where it is, as the function does', async () => {
    rows.future_workouts = [...rows.future_workouts, fwRow('fw-garbage', 'garbage')];
    const { result } = await mounted();
    rpcAnswer = async () => ({ data: 2, error: null });

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 2); });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(dateOf(result.current.futureWorkouts, 'fw-garbage')).toBe('garbage');
    expect(dateOf(result.current.futureWorkouts, 'fw-a')).toBe('2026-09-17');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('drops a malformed every-N-days anchor and start date rather than throwing on them', async () => {
    // A restored backup is written verbatim, so either can hold anything.
    rows.workout_programs = [{ ...programRow('not-a-date'), days: programDays('not-a-date') }];
    const { result } = await mounted();
    rpcAnswer = async () => ({ data: 2, error: null });

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 2); });

    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0][1] as { p_start_date: string | null; p_program_days: { label: string; frequency?: unknown }[] };
    expect(args.p_start_date).toBeNull();
    // sanitizeFrequency keeps the interval and drops the anchor it cannot read.
    expect(args.p_program_days.find(d => d.label === 'Run')?.frequency).toEqual({ type: 'everyNDays', interval: 3 });
    expect(args.p_program_days.find(d => d.label === 'Push')?.frequency).toEqual({ type: 'weekly', weekday: 1 });
    expect(result.current.programs.find(p => p.id === 'prog-1')?.startDate).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith('Shifted 2 workouts forward by 2 days');
  });

  it('sends a null start date for a program that has none', async () => {
    rows.workout_programs = [programRow(null)];
    const { result } = await mounted();
    rpcAnswer = async () => ({ data: 2, error: null });

    await act(async () => { await result.current.pushProgramBack('prog-1', FROM, 1); });

    expect(rpc).toHaveBeenCalledWith('shift_program_workouts', expect.objectContaining({ p_start_date: null }));
    expect(result.current.programs.find(p => p.id === 'prog-1')?.startDate).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith('Shifted 2 workouts forward by 1 day');
  });
});
