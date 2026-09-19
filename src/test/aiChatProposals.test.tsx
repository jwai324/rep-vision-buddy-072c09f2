import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', created_at: '2026-01-01T00:00:00Z' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  },
}));

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({ exercises: [] }),
}));

import { ChatProvider, useChatContext, COOLDOWN_MS, TEMPLATE_CHANGED_MESSAGE } from '@/contexts/ChatContext';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';
import { registerSession, unregisterSession, type SessionMutations } from '@/hooks/useSessionController';

const BENCH = 'flat-barbell-bench-press';
const PLANK = 'plank';
const PULL_UP = 'pull-up';
const PUSH_UP = 'push-up';

const row = (exerciseId: string, over: Record<string, unknown> = {}) =>
  ({ exerciseId, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, ...over });

type Storage = Record<string, unknown> & {
  templates: { id: string; name: string; exercises: Record<string, unknown>[] }[];
  programs: { id: string; name: string; days: { label: string; templateId: string }[] }[];
};

const makeStorage = (over: Partial<Storage> = {}): Storage => ({
  templates: [{ id: 't1', name: 'Push', exercises: [row(BENCH)] }],
  programs: [],
  futureWorkouts: [],
  history: [],
  bodyMeasurements: [],
  profile: {},
  preferences: {},
  activeProgramId: null,
  dataTrusted: true,
  saveTemplate: vi.fn(async () => true),
  deleteTemplate: vi.fn(async () => true),
  saveProgram: vi.fn(async () => true),
  deleteProgram: vi.fn(async () => true),
  setActiveProgram: vi.fn(async () => true),
  ...over,
});

const Probe: React.FC = () => {
  const chat = useChatContext();
  const list = Object.values(chat.proposals);
  return (
    <div>
      <span data-testid="statuses">{list.map(p => p.status).join(',')}</span>
      <span data-testid="errors">{list.map(p => p.error ?? '').join('|')}</span>
      <span data-testid="applied-notes">{chat.messages.filter(m => m.content.startsWith('_Applied')).length}</span>
      <button onClick={() => { void chat.sendMessage('go'); }}>send</button>
      {list.map(p => (
        <ProposalDiffCard key={p.id} proposal={p} templateNameById={{}} onApply={chat.applyProposal} onDiscard={chat.discardProposal} />
      ))}
    </div>
  );
};

const encoder = new TextEncoder();
const sse = (events: (object | string)[]) =>
  encoder.encode(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n`).join(''));

function readerOf(chunks: Uint8Array[]) {
  let i = 0;
  return {
    read: () => {
      const c = chunks[i++];
      if (!c) return Promise.resolve({ done: true as const, value: undefined });
      return Promise.resolve({ done: false as const, value: c });
    },
  };
}

const response = (status: number, body: Uint8Array[]) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({}),
  body: { getReader: () => readerOf(body) },
}) as unknown as Response;

const reply = (text: string) => response(200, [sse([
  { choices: [{ delta: { content: text }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  '[DONE]',
])]);

type Call = { name: string; args: unknown };
const toolTurn = (calls: Call[]) => response(200, [sse([
  { choices: [{ delta: { tool_calls: calls.map((c, index) => ({ index, id: `tc-${index + 1}`, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  '[DONE]',
])]);

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const flush = () => act(async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
});

/** Streams one reply carrying the given tool calls, then the follow-up narration. */
const propose = async (calls: Call[]) => {
  fetchMock.mockResolvedValueOnce(toolTurn(calls)).mockResolvedValueOnce(reply('Done.'));
  act(() => { vi.advanceTimersByTime(COOLDOWN_MS); });
  fireEvent.click(screen.getByText('send'));
  await flush();
};

const apply = async () => {
  fireEvent.click(screen.getByText('Apply'));
  await flush();
};

const text = (id: string) => screen.getByTestId(id).textContent;

const mount = (storage: Storage) => {
  const view = render(<ChatProvider storage={storage}><Probe /></ChatProvider>);
  return {
    ...view,
    // A storage change reaches the provider the way it does in the app: the
    // parent re-renders with the hook's new return value.
    swap: (next: Storage) => view.rerender(<ChatProvider storage={next}><Probe /></ChatProvider>),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The session controller warns in dev when a writer's stack lacks
  // applyProposal; the anonymous callback here never carries that name.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  unregisterSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a proposal while its save is in flight', () => {
  it('takes one Apply, disables the buttons, and posts one Applied note', async () => {
    let finish!: (v: boolean) => void;
    const storage = makeStorage({ saveProgram: vi.fn(() => new Promise<boolean>(r => { finish = r; })) });
    mount(storage);
    await flush();
    await propose([{ name: 'create_program', args: { name: 'PPL', days: [{ label: 'Day 1', templateId: 't1', frequency: { type: 'weekly', weekday: 1 } }] } }]);
    expect(text('statuses')).toBe('pending');

    fireEvent.click(screen.getByText('Apply'));
    fireEvent.click(screen.getByText('Apply'));
    await flush();
    expect(storage.saveProgram).toHaveBeenCalledTimes(1);
    expect(text('statuses')).toBe('applying');
    expect((screen.getByText('Apply').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Discard').closest('button') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { finish(true); });
    await flush();
    expect(text('statuses')).toBe('applied');
    expect(text('applied-notes')).toBe('1');
  });
});

describe('delete proposals', () => {
  it('stay pending when the server refuses the delete, and apply once it goes through', async () => {
    const storage = makeStorage({ deleteTemplate: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) });
    mount(storage);
    await flush();
    await propose([{ name: 'delete_template', args: { templateId: 't1' } }]);
    expect(text('statuses')).toBe('pending');

    await apply();
    expect(text('statuses')).toBe('pending');
    expect(text('applied-notes')).toBe('0');

    await apply();
    expect(text('statuses')).toBe('applied');
    expect(text('applied-notes')).toBe('1');
  });

  it('keep a program proposal pending when the delete failed', async () => {
    const storage = makeStorage({
      programs: [{ id: 'p1', name: 'PPL', days: [{ label: 'Day 1', templateId: 'rest' }] }],
      deleteProgram: vi.fn(async () => false),
    });
    mount(storage);
    await flush();
    await propose([{ name: 'delete_program', args: { programId: 'p1' } }]);
    await apply();
    expect(text('statuses')).toBe('pending');
    expect(text('applied-notes')).toBe('0');
  });

  it('are refused for a template a program still schedules, naming the program', async () => {
    const storage = makeStorage({ programs: [{ id: 'p1', name: 'PPL', days: [{ label: 'Day 1', templateId: 't1' }] }] });
    mount(storage);
    await flush();
    await propose([{ name: 'delete_template', args: { templateId: 't1' } }]);
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe('"Push" is used by "PPL". Remove it from that program first.');
  });

  it('are refused at Apply when a program started using the template after the proposal', async () => {
    const storage = makeStorage();
    const view = mount(storage);
    await flush();
    await propose([{ name: 'delete_template', args: { templateId: 't1' } }]);
    expect(text('statuses')).toBe('pending');

    view.swap(makeStorage({ programs: [{ id: 'p1', name: 'PPL', days: [{ label: 'Day 1', templateId: 't1' }] }] }));
    await apply();
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toMatch(/used by "PPL"/);
    expect(storage.deleteTemplate).not.toHaveBeenCalled();
  });
});

describe('a template edited between the proposal and Apply', () => {
  it('refuses a wholesale edit instead of overwriting the edit', async () => {
    const storage = makeStorage();
    const view = mount(storage);
    await flush();
    await propose([{ name: 'edit_template', args: { templateId: 't1', name: 'Push A', exercises: [row(BENCH, { sets: 4 })] } }]);
    expect(text('statuses')).toBe('pending');

    const edited = makeStorage({ templates: [{ id: 't1', name: 'Push', exercises: [row(BENCH), row(PUSH_UP)] }] });
    view.swap(edited);
    await apply();
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe(TEMPLATE_CHANGED_MESSAGE);
    expect(edited.saveTemplate).not.toHaveBeenCalled();
  });

  it('still applies a wholesale edit over a reloaded copy with the same content', async () => {
    const storage = makeStorage();
    const view = mount(storage);
    await flush();
    await propose([{ name: 'edit_template', args: { templateId: 't1', name: 'Push A' } }]);

    const reloaded = makeStorage({ templates: [{ id: 't1', name: 'Push', exercises: [row(BENCH)] }] });
    view.swap(reloaded);
    await apply();
    expect(text('statuses')).toBe('applied');
    expect(reloaded.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', name: 'Push A' }));
  });

  it('appends onto the template as it is now rather than the snapshot', async () => {
    const storage = makeStorage();
    const view = mount(storage);
    await flush();
    await propose([{ name: 'add_exercises_to_template', args: { templateId: 't1', exercises: [row(PLANK)] } }]);

    const edited = makeStorage({ templates: [{ id: 't1', name: 'Push', exercises: [row(BENCH), row(PUSH_UP)] }] });
    view.swap(edited);
    await apply();
    expect(text('statuses')).toBe('applied');
    const saved = (edited.saveTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0] as { exercises: { exerciseId: string }[] };
    expect(saved.exercises.map(e => e.exerciseId)).toEqual([BENCH, PUSH_UP, PLANK]);
  });

  it('refuses an append whose exercises the user has since added by hand', async () => {
    const storage = makeStorage();
    const view = mount(storage);
    await flush();
    await propose([{ name: 'add_exercises_to_template', args: { templateId: 't1', exercises: [row(PLANK)] } }]);

    const edited = makeStorage({ templates: [{ id: 't1', name: 'Push', exercises: [row(BENCH), row(PLANK)] }] });
    view.swap(edited);
    await apply();
    expect(text('statuses')).toBe('invalid');
    expect(edited.saveTemplate).not.toHaveBeenCalled();
  });
});

describe('what the coach may write into a template', () => {
  it('saves an unknown set type as normal', async () => {
    const storage = makeStorage();
    mount(storage);
    await flush();
    await propose([{ name: 'create_template', args: { name: 'Legs', exercises: [row(PULL_UP, { setType: 'giant' })] } }]);
    await apply();
    expect(text('statuses')).toBe('applied');
    const saved = (storage.saveTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0] as { exercises: { setType: string }[] };
    expect(saved.exercises[0].setType).toBe('normal');
  });

  it('rejects a zero set count with the reason', async () => {
    mount(makeStorage());
    await flush();
    await propose([{ name: 'create_template', args: { name: 'Legs', exercises: [row(PULL_UP, { sets: 0 })] } }]);
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toMatch(/Pull-Up: sets must be a whole number from 1 to 20/);
  });

  it('gives an appended pair a superset id the template is not using', async () => {
    const storage = makeStorage({ templates: [{ id: 't1', name: 'Push', exercises: [row(BENCH, { supersetGroup: 1 }), row(PUSH_UP, { supersetGroup: 1 })] }] });
    mount(storage);
    await flush();
    await propose([{ name: 'add_exercises_to_template', args: { templateId: 't1', exercises: [row(PLANK, { supersetGroup: 1 }), row(PULL_UP, { supersetGroup: 1 })] } }]);
    await apply();
    const saved = (storage.saveTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0] as { exercises: { supersetGroup?: number }[] };
    expect(saved.exercises.map(e => e.supersetGroup)).toEqual([1, 1, 2, 2]);
  });
});

describe('a program pointing at a template that does not exist', () => {
  it('is rejected naming the missing id', async () => {
    mount(makeStorage());
    await flush();
    await propose([{ name: 'create_program', args: { name: 'PPL', days: [
      { label: 'Day 1', templateId: 't1', frequency: { type: 'weekly', weekday: 1 } },
      { label: 'Day 2', templateId: 'ghost', frequency: { type: 'weekly', weekday: 3 } },
    ] } }]);
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toMatch(/Unknown template id: "ghost"/);
  });
});

describe('swapping an exercise in the live workout', () => {
  const block = (exerciseId: string, exerciseName: string) => ({
    exerciseId, exerciseName, restSeconds: 90,
    sets: [{ setNumber: 1, weight: '', reps: '', completed: false, type: 'normal' as const, rpe: '', time: '' }],
  });
  const session = (blocks: ReturnType<typeof block>[]): SessionMutations => ({
    addExercise: vi.fn(() => true),
    addSets: vi.fn(() => true),
    updateSet: vi.fn(() => true),
    swapExercise: vi.fn(() => true),
    getBlocks: () => blocks,
    getStartTime: () => Date.now(),
    getActiveRestTimer: () => null,
  });

  it('is refused for an exercise already in the workout', async () => {
    registerSession(session([block(BENCH, 'Flat Barbell Bench Press'), block(PLANK, 'Plank')]));
    mount(makeStorage());
    await flush();
    await propose([{ name: 'swap_exercise_in_workout', args: { exerciseId: BENCH, newExerciseId: PLANK } }]);
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe('Plank is already in the workout.');
  });

  it('is refused at Apply when the exercise was added by hand since', async () => {
    const blocks = [block(BENCH, 'Flat Barbell Bench Press')];
    const controller = session(blocks);
    registerSession(controller);
    mount(makeStorage());
    await flush();
    await propose([{ name: 'swap_exercise_in_workout', args: { exerciseId: BENCH, newExerciseId: PLANK } }]);
    expect(text('statuses')).toBe('pending');

    blocks.push(block(PLANK, 'Plank'));
    await apply();
    expect(text('statuses')).toBe('invalid');
    expect(controller.swapExercise).not.toHaveBeenCalled();
  });
});
