import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage() { /* noop */ }
    terminate() { /* noop */ }
  }
  return { FakeWorker };
});

vi.mock('@/workers/restTimerWorker?worker', () => ({ default: FakeWorker }));
vi.mock('@/utils/restTimerSound', () => ({
  scheduleRestTimerSound: vi.fn(() => vi.fn()),
  playRestTimerSoundNow: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', created_at: '2026-01-01T00:00:00Z' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

import { ChatProvider, useChatContext, COOLDOWN_MS, WORKOUT_CHANGED_MESSAGE } from '@/contexts/ChatContext';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';
import { ActiveSession } from '@/components/ActiveSession';
import { registerSession, unregisterSession, type SessionMutations } from '@/hooks/useSessionController';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import type { ActiveSessionCache, ExerciseBlock } from '@/types/activeSession';
import type { ExerciseId, WorkoutSession } from '@/types/workout';

const BENCH = 'flat-barbell-bench-press' as ExerciseId;
const BENCH_NAME = 'Flat Barbell Bench Press';
const PLANK = 'plank' as ExerciseId;
const SQUAT = 'barbell-back-squat' as ExerciseId;

const WORKOUT_START = 1_700_000_000_000;

const block = (exerciseId: ExerciseId, exerciseName: string): ExerciseBlock => ({
  exerciseId,
  exerciseName,
  restSeconds: 90,
  sets: [{ setNumber: 1, weight: '60', reps: '8', completed: false, type: 'normal', rpe: '', time: '' }],
});

const cacheFor = (blocks: ExerciseBlock[], over: Partial<ActiveSessionCache> = {}): ActiveSessionCache => ({
  blocks,
  workoutName: 'Push Day',
  startTimestamp: WORKOUT_START,
  trueStartTimestamp: WORKOUT_START,
  elapsedAtCache: 120,
  templateId: 't1',
  ...over,
});

const writeCache = (cache: ActiveSessionCache | null) => {
  if (cache) localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cache));
  else localStorage.removeItem(ACTIVE_SESSION_CACHE_KEY);
};

const readCache = (): ActiveSessionCache | null => {
  const raw = localStorage.getItem(ACTIVE_SESSION_CACHE_KEY);
  return raw ? (JSON.parse(raw) as ActiveSessionCache) : null;
};

/** What ActiveSession registers while its screen is mounted. */
const mountedScreen = (blocks: ExerciseBlock[]): SessionMutations => ({
  addExercise: vi.fn(() => true),
  addSets: vi.fn(() => true),
  updateSet: vi.fn(() => true),
  swapExercise: vi.fn(() => true),
  getBlocks: () => blocks,
  getStartTime: () => WORKOUT_START,
  getActiveRestTimer: () => null,
});

type Storage = Record<string, unknown>;
const makeStorage = (over: Storage = {}): Storage => ({
  templates: [],
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

const reply = (t: string) => response(200, [sse([
  { choices: [{ delta: { content: t }, finish_reason: null }] },
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

const send = async () => {
  fetchMock.mockResolvedValueOnce(reply('Noted.'));
  act(() => { vi.advanceTimersByTime(COOLDOWN_MS); });
  fireEvent.click(screen.getByText('send'));
  await flush();
};

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

/** The context the last turn put in front of the model. */
type SentSession = { minimized: boolean; exercises: { exerciseId: string; total_sets: number }[] };
const sentSession = (): SentSession | undefined => {
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { context: { active_session?: SentSession } };
  return body.context.active_session;
};

const mount = (storage: Storage = makeStorage()) =>
  render(<ChatProvider storage={storage}><Probe /></ChatProvider>);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The controller warns in dev when a writer's stack lacks applyProposal;
  // the stub registered here never carries that name.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  unregisterSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a workout that has been minimized', () => {
  it('still takes a proposal made while its screen was open, and shows it when expanded again', async () => {
    writeCache(cacheFor([block(BENCH, BENCH_NAME)]));
    const open = mountedScreen([block(BENCH, BENCH_NAME)]);
    registerSession(open);
    mount();
    await flush();

    await propose([{ name: 'add_exercise_to_workout', args: { exerciseId: PLANK, sets: 2, targetReps: 30 } }]);
    expect(text('statuses')).toBe('pending');

    // Minimizing unmounts the screen, which unregisters the controller.
    unregisterSession();
    await apply();

    expect(text('statuses')).toBe('applied');
    // The workout took the change through the cache, not through a screen
    // that is no longer there.
    expect(open.addExercise).not.toHaveBeenCalled();
    const blocks = readCache()!.blocks;
    expect(blocks.map(b => b.exerciseId)).toEqual([BENCH, PLANK]);
    expect(blocks[1].sets).toHaveLength(2);
    expect(blocks[1].sets[0].reps).toBe('30');
    // Everything else about the workout survives the write.
    expect(readCache()!.workoutName).toBe('Push Day');
    expect(readCache()!.elapsedAtCache).toBe(120);

    // Expanding the workout is a fresh mount off that cache.
    render(
      <ActiveSession
        exercises={[BENCH]}
        templateId="t1"
        cachedSession={readCache()}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Options for Plank' })).toBeInTheDocument();
  });

  it('is described to the coach as a workout in progress, and as gone once it is over', async () => {
    writeCache(cacheFor([block(BENCH, BENCH_NAME)]));
    mount();
    await flush();

    await send();
    expect(sentSession()).toMatchObject({ minimized: true });
    expect(sentSession()!.exercises.map(e => e.exerciseId)).toEqual([BENCH]);

    // Finished and saved, or discarded from the bar: the cache is cleared.
    writeCache(null);
    await send();
    expect(sentSession()).toBeUndefined();
  });

  it('is described as on screen while its screen is mounted', async () => {
    writeCache(cacheFor([block(BENCH, BENCH_NAME)]));
    registerSession(mountedScreen([block(BENCH, BENCH_NAME)]));
    mount();
    await flush();

    await send();
    expect(sentSession()).toMatchObject({ minimized: false });
  });

  it('updates the working set a warm-up shares a number with, and swaps in place', async () => {
    const warmed: ExerciseBlock = {
      ...block(BENCH, BENCH_NAME),
      sets: [
        { setNumber: 1, weight: '20', reps: '10', completed: true, type: 'warmup', rpe: '', time: '' },
        { setNumber: 1, weight: '60', reps: '8', completed: false, type: 'normal', rpe: '', time: '' },
      ],
    };
    writeCache(cacheFor([warmed, block(SQUAT, 'Barbell Back Squat')]));
    mount();
    await flush();

    await propose([{ name: 'update_set_weight_reps', args: { exerciseId: BENCH, setNumber: 1, weight: 65, reps: 6 } }]);
    await apply();
    expect(text('statuses')).toBe('applied');
    const sets = readCache()!.blocks[0].sets;
    // The warm-up carries its own 1..n numbering, exactly as on screen.
    expect(sets[0]).toMatchObject({ type: 'warmup', weight: '20', reps: '10' });
    expect(sets[1]).toMatchObject({ type: 'normal', weight: '65', reps: '6' });

    // The applied card keeps no Apply button, so the only one on screen is the
    // new proposal's. (The stream ids both tool calls tc-1, so the second
    // proposal takes the first one's place in the map.)
    await propose([{ name: 'swap_exercise_in_workout', args: { exerciseId: SQUAT, newExerciseId: PLANK } }]);
    await apply();
    expect(text('statuses')).toBe('applied');
    const blocks = readCache()!.blocks;
    expect(blocks.map(b => b.exerciseId)).toEqual([BENCH, PLANK]);
    expect(blocks[1].exerciseName).toBe('Plank');
    // The swap keeps the row where it was, so the sets logged on it stay put.
    expect(blocks[1].sets).toHaveLength(1);
  });

  it('takes a proposal made while it was already minimized', async () => {
    writeCache(cacheFor([block(BENCH, BENCH_NAME)]));
    mount();
    await flush();

    await propose([{ name: 'add_sets_to_exercise', args: { exerciseId: BENCH, count: 2 } }]);
    expect(text('statuses')).toBe('pending');
    await apply();

    expect(text('statuses')).toBe('applied');
    expect(readCache()!.blocks[0].sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
  });
});

describe('a proposal whose workout is not there any more', () => {
  it('is refused rather than applied to a different workout', async () => {
    writeCache(cacheFor([block(BENCH, BENCH_NAME)]));
    mount();
    await flush();
    await propose([{ name: 'add_exercise_to_workout', args: { exerciseId: PLANK } }]);
    expect(text('statuses')).toBe('pending');

    // That workout was discarded and another one started in its place.
    writeCache(cacheFor([block(SQUAT, 'Barbell Back Squat')], {
      templateId: 't2',
      startTimestamp: WORKOUT_START + 900_000,
      trueStartTimestamp: WORKOUT_START + 900_000,
    }));
    await apply();

    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe(WORKOUT_CHANGED_MESSAGE);
    expect(readCache()!.blocks.map(b => b.exerciseId)).toEqual([SQUAT]);
  });

  it('says there is no workout when it was discarded before Apply', async () => {
    writeCache(cacheFor([block(BENCH, BENCH_NAME)]));
    mount();
    await flush();
    await propose([{ name: 'add_exercise_to_workout', args: { exerciseId: PLANK } }]);

    writeCache(null);
    await apply();

    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe('No active workout session.');
  });
});

describe('editing a past workout', () => {
  const past: WorkoutSession = {
    id: 'sess-1',
    date: '2026-09-10',
    startedAt: '2026-09-10T18:05:00.000Z',
    duration: 1960,
    exercises: [{
      exerciseId: BENCH,
      exerciseName: BENCH_NAME,
      sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }],
    }],
    totalVolume: 480,
    totalSets: 1,
    totalReps: 8,
  };

  it('stays invisible to the coach — no screen registered and no cache written', async () => {
    render(<ActiveSession exercises={[]} editSession={past} onFinish={vi.fn()} onCancel={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY)).toBeNull();

    mount();
    await flush();
    await send();
    expect(sentSession()).toBeUndefined();

    await propose([{ name: 'add_exercise_to_workout', args: { exerciseId: PLANK } }]);
    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe('No active workout session. Start a workout first.');
  });
});
