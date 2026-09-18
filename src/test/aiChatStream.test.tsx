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

const CUSTOM_ID = 'custom-95ca6d55-5bd8-4e0a-9f77-2b1c0d3e4f56';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [{
      id: CUSTOM_ID,
      name: 'Wall Sit Hold',
      primaryBodyPart: 'Quads',
      equipment: 'Bodyweight',
      difficulty: 'Beginner' as const,
      exerciseType: 'Isolation' as const,
      movementPattern: 'Squat',
      secondaryMuscles: [],
      isCustom: true as const,
      isRecovery: false,
      excludeFromVolume: false,
    }],
  }),
}));

import { ChatProvider, useChatContext, COOLDOWN_MS } from '@/contexts/ChatContext';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';
import { formatLocalDate } from '@/utils/dateUtils';
import { FREE_MONTHLY_MICROS, PREMIUM_MONTHLY_MICROS, creditsFromMicros } from '@/utils/credits';
import type { WorkoutSession, WorkoutSet } from '@/types/workout';

const BENCH = 'flat-barbell-bench-press';
const INCLINE = 'incline-barbell-bench-press';

type Storage = Record<string, unknown>;

const makeStorage = (over: Storage = {}): Storage => ({
  templates: [{ id: 't1', name: 'Push', exercises: [{ exerciseId: BENCH, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }] }],
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
  ...over,
});

const Probe: React.FC = () => {
  const chat = useChatContext();
  const ids = chat.messages.map(m => m.id);
  const last = chat.messages[chat.messages.length - 1];
  return (
    <div>
      <span data-testid="loading">{String(chat.isLoading)}</span>
      <span data-testid="errors">{chat.consecutiveErrors}</span>
      <span data-testid="count">{chat.messages.length}</span>
      <span data-testid="dup-ids">{ids.length - new Set(ids).size}</span>
      <span data-testid="last">{last?.content ?? ''}</span>
      <span data-testid="credits">{chat.creditsBalance.credits}</span>
      <ul>
        {chat.messages.map(m => <li key={m.id} data-testid="msg">{m.role}:{m.content}</li>)}
      </ul>
      <button onClick={() => { void chat.sendMessage('go'); }}>send</button>
      {Object.values(chat.proposals).map(p => (
        <ProposalDiffCard key={p.id} proposal={p} templateNameById={{}} onApply={chat.applyProposal} onDiscard={chat.discardProposal} />
      ))}
    </div>
  );
};

const encoder = new TextEncoder();
const sse = (events: (object | string)[]) =>
  encoder.encode(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n`).join(''));

type ReadResult = { done: boolean; value?: Uint8Array };

/** A body whose chunks the test hands over one at a time; `end()` closes it. */
function scriptedBody() {
  const queue: ReadResult[] = [];
  const waiting: ((r: ReadResult) => void)[] = [];
  const deliver = (r: ReadResult) => {
    const w = waiting.shift();
    if (w) w(r); else queue.push(r);
  };
  return {
    push: (chunk: Uint8Array) => deliver({ done: false, value: chunk }),
    end: () => deliver({ done: true }),
    getReader: () => ({
      read: () => new Promise<ReadResult>(resolve => {
        const r = queue.shift();
        if (r) resolve(r); else waiting.push(resolve);
      }),
    }),
  };
}

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

const response = (status: number, body: Uint8Array[] | object) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (Array.isArray(body) ? {} : body),
  body: { getReader: () => readerOf(Array.isArray(body) ? body : []) },
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

const send = async () => {
  act(() => { vi.advanceTimersByTime(COOLDOWN_MS); });
  fireEvent.click(screen.getByText('send'));
  await flush();
};

const text = (id: string) => screen.getByTestId(id).textContent;
const messages = () => screen.getAllByTestId('msg').map(li => li.textContent);

const actionResults = (call: number) =>
  JSON.parse(fetchMock.mock.calls[call][1]?.body as string).action_results as { tool_call_id: string; result: Record<string, unknown> }[];

const mount = (storage: Storage) => {
  const view = render(<ChatProvider storage={storage}><Probe /></ChatProvider>);
  return {
    swap: (next: Storage) => view.rerender(<ChatProvider storage={next}><Probe /></ChatProvider>),
  };
};

const realConsoleError = console.error;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] !== 'Chat error:') realConsoleError(...args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a reply streaming while the thread changes', () => {
  it('keeps to one bubble when a proposal is discarded mid-stream', async () => {
    mount(makeStorage());
    await flush();
    fetchMock.mockResolvedValueOnce(toolTurn([{ name: 'delete_template', args: { templateId: 't1' } }])).mockResolvedValueOnce(reply('Shall I?'));
    await send();
    expect(screen.getByText('Discard')).toBeInTheDocument();
    const before = messages().length;

    const body = scriptedBody();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), body } as unknown as Response);
    await send();
    await act(async () => { body.push(sse([{ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }])); });
    await flush();
    expect(text('last')).toBe('Hello');

    fireEvent.click(screen.getByText('Discard'));
    await flush();
    expect(text('last')).toMatch(/^_Discarded:/);

    await act(async () => {
      body.push(sse([{ choices: [{ delta: { content: ' world' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']));
      body.end();
    });
    await flush();

    expect(text('loading')).toBe('false');
    expect(text('dup-ids')).toBe('0');
    const all = messages();
    // user, the whole reply in its own bubble, then the note that landed during it
    expect(all.length).toBe(before + 3);
    expect(all.slice(before)).toEqual(['user:go', 'assistant:Hello world', expect.stringMatching(/^assistant:_Discarded:/)]);
  });
});

describe('a follow-up that fails', () => {
  const analysis = () => toolTurn([{ name: 'get_workout_history', args: { analysisType: 'summary' } }]);

  it('shows the server sentence from an {error} chunk instead of "completed"', async () => {
    mount(makeStorage());
    await flush();
    fetchMock
      .mockResolvedValueOnce(analysis())
      .mockResolvedValueOnce(response(200, [sse([{ error: 'Upstream ran out of credit.' }])]));
    await send();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text('last')).toBe('Upstream ran out of credit.');
    expect(text('loading')).toBe('false');
    expect(text('errors')).toBe('1');
  });

  it('adds the reason from a refused follow-up to the summary', async () => {
    mount(makeStorage());
    await flush();
    fetchMock
      .mockResolvedValueOnce(analysis())
      .mockResolvedValueOnce(response(402, { error: "You're out of AI credits.", balance_exhausted: true }));
    await send();
    expect(text('last')).toBe("get_workout_history completed You're out of AI credits.");
    expect(text('loading')).toBe('false');
  });
});

describe('the credit balance', () => {
  it('is re-derived when the profile tier arrives', async () => {
    const { swap } = mount(makeStorage({ profile: {} }));
    await flush();
    expect(text('credits')).toBe(String(creditsFromMicros(FREE_MONTHLY_MICROS)));

    swap(makeStorage({ profile: { subscriptionTier: 'premium' } }));
    await flush();
    expect(text('credits')).toBe(String(creditsFromMicros(PREMIUM_MONTHLY_MICROS)));
  });
});

describe('history analyses', () => {
  const set = (weight: number, type: WorkoutSet['type'] = 'normal'): WorkoutSet => ({ setNumber: 1, type, reps: 8, weight });
  const session = (id: string, date: string, exercises: WorkoutSession['exercises']): WorkoutSession => ({
    id, date, exercises, duration: 3600, totalVolume: 0, totalSets: 0, totalReps: 0,
  });
  const today = formatLocalDate();
  const yesterday = formatLocalDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const history = [
    session('s1', today, [
      { exerciseId: BENCH, exerciseName: 'Flat Barbell Bench Press', sets: [set(40, 'warmup'), set(80), set(80)] },
      { exerciseId: INCLINE, exerciseName: 'Incline Barbell Bench Press', sets: [set(60), set(60)] },
      { exerciseId: CUSTOM_ID, exerciseName: 'Old Name', sets: [set(50)] },
    ]),
    session('s2', yesterday, [
      { exerciseId: BENCH, exerciseName: 'Flat Barbell Bench Press', sets: [set(85), set(85)] },
      { exerciseId: CUSTOM_ID, exerciseName: 'Wall Sit Hold', sets: [set(60, 'warmup'), set(55)] },
    ]),
  ];

  const results = async () => {
    mount(makeStorage({ history }));
    await flush();
    fetchMock
      .mockResolvedValueOnce(toolTurn([
        { name: 'get_workout_history', args: { analysisType: 'frequency' } },
        { name: 'get_workout_history', args: { analysisType: 'volume_by_muscle' } },
        { name: 'get_workout_history', args: { analysisType: 'prs' } },
      ]))
      .mockResolvedValueOnce(reply('Here you go.'));
    await send();
    const [frequency, volume, prs] = actionResults(1).map(r => r.result);
    return { frequency, volume, prs };
  };

  it('count a body part once per session, as the Frequency chart does', async () => {
    const { frequency } = await results();
    expect(frequency.frequency).toEqual({ Chest: 2, Quads: 2 });
  });

  it('leave warm-up sets out of sets per muscle, as the charts do', async () => {
    const { volume } = await results();
    expect(volume.sets_by_muscle).toEqual({ Chest: 6, Quads: 2 });
  });

  it('group PRs by exercise id under the name the library has now', async () => {
    const { prs } = await results();
    expect(prs.prs).toEqual({
      'Flat Barbell Bench Press': { exercise_id: BENCH, weight: 85, reps: 8 },
      'Incline Barbell Bench Press': { exercise_id: INCLINE, weight: 60, reps: 8 },
      'Wall Sit Hold': { exercise_id: CUSTOM_ID, weight: 55, reps: 8 },
    });
  });
});
