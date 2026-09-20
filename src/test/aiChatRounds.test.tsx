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

import {
  ChatProvider, useChatContext, COOLDOWN_MS, MAX_ASSISTANT_ROUNDS, TRUNCATED_PROPOSAL_MESSAGE,
} from '@/contexts/ChatContext';
import { registerSession, unregisterSession, type SessionMutations } from '@/hooks/useSessionController';

const BENCH = 'flat-barbell-bench-press';
const PLANK = 'plank';
const PULL_UP = 'pull-up';

const row = (exerciseId: string, over: Record<string, unknown> = {}) =>
  ({ exerciseId, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, ...over });

type Storage = Record<string, unknown>;

const makeStorage = (over: Storage = {}): Storage => ({
  templates: [{ id: 't1', name: 'Pull', exercises: [row(PULL_UP)] }],
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
  ...over,
});

const Probe: React.FC = () => {
  const chat = useChatContext();
  const list = Object.values(chat.proposals);
  const last = chat.messages[chat.messages.length - 1];
  return (
    <div>
      <span data-testid="loading">{String(chat.isLoading)}</span>
      <span data-testid="errors">{chat.consecutiveErrors}</span>
      <span data-testid="last">{last?.content ?? ''}</span>
      <span data-testid="statuses">{list.map(p => p.status).join(',')}</span>
      <span data-testid="summaries">{list.map(p => p.summary).join('|')}</span>
      <span data-testid="proposal-errors">{list.map(p => p.error ?? '').join('|')}</span>
      <button onClick={() => { void chat.sendMessage('go'); }}>send</button>
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

/** A tool call the model emits. `rawArgs` sends argument JSON verbatim, which
 *  is how a call cut off at max_tokens arrives. */
type Call = { id: string; name: string; args?: unknown; rawArgs?: string };

const toolTurn = (
  calls: Call[],
  opts: { content?: string; finish?: 'tool_calls' | 'length' } = {},
) => response(200, [sse([
  ...(opts.content ? [{ choices: [{ delta: { content: opts.content }, finish_reason: null }] }] : []),
  {
    choices: [{
      delta: {
        tool_calls: calls.map((c, index) => ({
          index,
          id: c.id,
          function: { name: c.name, arguments: c.rawArgs ?? JSON.stringify(c.args ?? {}) },
        })),
      },
      finish_reason: null,
    }],
  },
  { choices: [{ delta: {}, finish_reason: opts.finish ?? 'tool_calls' }] },
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

const bodyOf = (call: number) =>
  JSON.parse(fetchMock.mock.calls[call][1]?.body as string) as {
    messages: { role: string; content: string | null; tool_calls?: { id: string }[]; tool_call_id?: string }[];
    action_results?: { tool_call_id: string; result: Record<string, unknown> }[];
  };

const realConsoleError = console.error;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] !== 'Chat error:') realConsoleError(...args);
  });
});

afterEach(() => {
  unregisterSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a reply cut off at the output limit', () => {
  it('is not followed up when nothing in it survived: one call, one card', async () => {
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    fetchMock.mockResolvedValueOnce(toolTurn(
      [{ id: 'cut-1', name: 'create_template', rawArgs: '{"name":"Legs","exercises":[{"exerciseId":"back-squ' }],
      { finish: 'length' },
    ));
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text('statuses')).toBe('invalid');
    expect(text('proposal-errors')).toBe(TRUNCATED_PROPOSAL_MESSAGE);
    expect(text('last')).toBe(TRUNCATED_PROPOSAL_MESSAGE);
    expect(text('loading')).toBe('false');
    expect(text('errors')).toBe('0');
  });

  it('is still followed up when part of it came through', async () => {
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([
        { id: 'ok-1', name: 'add_exercises_to_template', args: { templateId: 't1', exercises: [row(PLANK)] } },
        { id: 'cut-1', name: 'create_template', rawArgs: '{"name":"Legs","exer' },
      ], { finish: 'length' }))
      .mockResolvedValueOnce(reply('The plank add is ready; the leg day was too big.'));
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text('statuses')).toBe('pending,invalid');
    expect(text('last')).toBe('The plank add is ready; the leg day was too big.');
  });
});

describe('a turn that looks something up and then acts on it', () => {
  it('runs the tool calls of the round that follows the lookup', async () => {
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([{ id: 'r1-1', name: 'get_workout_history', args: { analysisType: 'volume_by_muscle', days: 30 } }]))
      .mockResolvedValueOnce(toolTurn(
        [{ id: 'r2-1', name: 'add_exercises_to_template', args: { templateId: 't1', exercises: [row(PLANK)] } }],
        { content: 'Your pulling volume is light.' },
      ))
      .mockResolvedValueOnce(reply('Drafted two additions — apply when ready.'));
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text('statuses')).toBe('pending');
    expect(text('summaries')).toBe('Add 1 exercise to "Pull"');
    // Both rounds' prose reads as one reply.
    expect(text('last')).toBe('Your pulling volume is light.\n\nDrafted two additions — apply when ready.');
    expect(text('loading')).toBe('false');
    expect(text('errors')).toBe('0');

    // The lookup's result rides on round two, and is part of the history by
    // round three alongside the assistant turn that acted on it.
    expect(bodyOf(1).action_results?.[0].tool_call_id).toBe('r1-1');
    const third = bodyOf(2);
    expect(third.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(['r1-1']);
    expect(third.messages.filter(m => m.tool_calls?.length).map(m => m.tool_calls![0].id)).toEqual(['r1-1', 'r2-1']);
    expect(third.action_results?.[0].tool_call_id).toBe('r2-1');
  });

  it('stops at the round cap without reporting an error', async () => {
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    for (let round = 1; round <= MAX_ASSISTANT_ROUNDS; round++) {
      fetchMock.mockResolvedValueOnce(toolTurn(
        [{ id: `r${round}-1`, name: 'get_workout_history', args: { analysisType: 'summary' } }],
        { content: `Round ${round}.` },
      ));
    }
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ASSISTANT_ROUNDS);
    expect(text('last')).toBe('Round 1.\n\nRound 2.\n\nRound 3.');
    expect(text('loading')).toBe('false');
    expect(text('errors')).toBe('0');
  });

  it('rejects the same session add proposed again in a later round', async () => {
    const blocks = [{
      exerciseId: BENCH,
      exerciseName: 'Flat Barbell Bench Press',
      restSeconds: 90,
      sets: [{ setNumber: 1, weight: '', reps: '', completed: false, type: 'normal' as const, rpe: '', time: '' }],
    }];
    const session: SessionMutations = {
      addExercise: vi.fn(() => true),
      addSets: vi.fn(() => true),
      updateSet: vi.fn(() => true),
      swapExercise: vi.fn(() => true),
      getBlocks: () => blocks,
      getStartTime: () => Date.now(),
      getActiveRestTimer: () => null,
    };
    registerSession(session);
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    const add = (id: string) => toolTurn([{ id, name: 'add_exercise_to_workout', args: { exerciseId: PLANK, sets: 3 } }]);
    fetchMock
      .mockResolvedValueOnce(add('r1-1'))
      .mockResolvedValueOnce(add('r2-1'))
      .mockResolvedValueOnce(reply('Done.'));
    await send();

    expect(text('statuses')).toBe('pending,invalid');
    expect(text('proposal-errors')).toBe('|Plank is already in your workout.');
  });
});

describe('a drafted template', () => {
  it('tells the coach the id it will have once applied', async () => {
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([{ id: 'tc-1', name: 'create_template', args: { name: 'Legs', exercises: [row(PULL_UP)] } }]))
      .mockResolvedValueOnce(reply('Drafted Legs.'));
    await send();

    const result = bodyOf(1).action_results?.[0].result as { success: boolean; templateId?: string };
    expect(result.success).toBe(true);
    expect(typeof result.templateId).toBe('string');
    expect(result.templateId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives a drafted program its id too', async () => {
    render(<ChatProvider storage={makeStorage()}><Probe /></ChatProvider>);
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([{
        id: 'tc-1',
        name: 'create_program',
        args: { name: 'PPL', days: [{ label: 'Day 1', templateId: 't1', frequency: { type: 'weekly', weekday: 1 } }] },
      }]))
      .mockResolvedValueOnce(reply('Drafted PPL.'));
    await send();

    const result = bodyOf(1).action_results?.[0].result as { success: boolean; programId?: string };
    expect(result.success).toBe(true);
    expect(result.programId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
