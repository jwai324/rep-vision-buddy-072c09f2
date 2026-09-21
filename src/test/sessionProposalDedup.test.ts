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

import { ChatProvider, useChatContext, isDuplicateSessionAdd, COOLDOWN_MS } from '@/contexts/ChatContext';
import type { Proposal } from '@/contexts/ChatContext';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';
import { registerSession, unregisterSession, type SessionMutations } from '@/hooks/useSessionController';

type Candidate = Pick<Proposal, 'toolName' | 'arguments' | 'status'>;

const mkAdd = (exerciseId: string, status: Proposal['status'] = 'pending'): Candidate => ({
  toolName: 'add_exercise_to_workout',
  arguments: { exerciseId },
  status,
});

// These exercise the exported helper itself — the predicate one round of the
// tool loop asks about one candidate. They are not a copy of the loop, so they
// stay; the loop's own accumulation is covered below by driving ChatContext.
describe('isDuplicateSessionAdd', () => {
  it('first add for an exerciseId is not a duplicate (empty covered set)', () => {
    expect(isDuplicateSessionAdd(mkAdd('bench-press'), new Set())).toBe(false);
  });

  it('second add for an already-covered exerciseId is a duplicate', () => {
    expect(isDuplicateSessionAdd(mkAdd('bench-press'), new Set(['bench-press']))).toBe(true);
  });

  it('distinct exerciseId is never collapsed even when another is covered', () => {
    expect(isDuplicateSessionAdd(mkAdd('squat'), new Set(['bench-press']))).toBe(false);
  });

  it('non-add session tools are never treated as duplicates', () => {
    const p = { ...mkAdd('bench-press'), toolName: 'add_sets_to_exercise' as const };
    expect(isDuplicateSessionAdd(p, new Set(['bench-press']))).toBe(false);
  });

  it('an invalid-status proposal is never collapsed (rejected cards pass through)', () => {
    expect(isDuplicateSessionAdd(mkAdd('bench-press', 'invalid'), new Set(['bench-press']))).toBe(false);
  });

  it('missing exerciseId is not a duplicate', () => {
    const p: Candidate = { toolName: 'add_exercise_to_workout', arguments: {}, status: 'pending' };
    expect(isDuplicateSessionAdd(p, new Set(['bench-press']))).toBe(false);
  });
});

const BENCH = 'flat-barbell-bench-press';
const PLANK = 'plank';
const PUSH_UP = 'push-up';

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

const block = (exerciseId: string, exerciseName: string) => ({
  exerciseId,
  exerciseName,
  restSeconds: 90,
  sets: [{ setNumber: 1, weight: '', reps: '', completed: false, type: 'normal' as const, rpe: '', time: '' }],
});

const liveSession = (blocks: ReturnType<typeof block>[]): SessionMutations => ({
  addExercise: vi.fn(() => true),
  addSets: vi.fn(() => true),
  updateSet: vi.fn(() => true),
  swapExercise: vi.fn(() => true),
  getBlocks: () => blocks,
  getStartTime: () => Date.now(),
  getActiveRestTimer: () => null,
});

// The cards are rendered so the assertions read what the user is actually
// offered: a rejected duplicate carries its sentence and no Apply button.
const Probe: React.FC = () => {
  const chat = useChatContext();
  const list = Object.values(chat.proposals);
  return React.createElement(
    'div',
    null,
    React.createElement('span', { 'data-testid': 'statuses' }, list.map(p => p.status).join(',')),
    React.createElement('span', { 'data-testid': 'errors' }, list.map(p => p.error ?? '').join('|')),
    React.createElement('span', { 'data-testid': 'summaries' }, list.map(p => p.summary).join('|')),
    React.createElement('button', { onClick: () => { void chat.sendMessage('go'); } }, 'send'),
    ...list.map(p => React.createElement(ProposalDiffCard, {
      key: p.id,
      proposal: p,
      templateNameById: {},
      onApply: chat.applyProposal,
      onDiscard: chat.discardProposal,
    })),
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

type Call = { id: string; name: string; args: unknown };

/** One assistant round carrying tool calls, in the OpenAI shape the client parses. */
const toolTurn = (calls: Call[]) => response(200, [sse([
  {
    choices: [{
      delta: {
        tool_calls: calls.map((c, index) => ({
          index,
          id: c.id,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      },
      finish_reason: null,
    }],
  },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  '[DONE]',
])]);

const addCall = (id: string, exerciseId: string): Call =>
  ({ id, name: 'add_exercise_to_workout', args: { exerciseId, sets: 3 } });

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

const mount = (storage: Storage = makeStorage()) =>
  render(React.createElement(ChatProvider, { storage, children: React.createElement(Probe) }));

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

describe('the same exercise added twice in one coach reply', () => {
  beforeEach(() => {
    registerSession(liveSession([block(BENCH, 'Flat Barbell Bench Press')]));
  });

  it('offers one suggestion and rejects the repeat as already in the workout', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('tc-1', PLANK), addCall('tc-2', PLANK)]))
      .mockResolvedValueOnce(reply('Added a plank.'));
    await send();

    expect(text('statuses')).toBe('pending,invalid');
    expect(text('errors')).toBe('|Plank is already in your workout.');
    expect(text('summaries')).toBe('Add Plank to your workout|Invalid add exercise to workout proposal');
    // Exactly one card is actionable: the rejected repeat offers no Apply.
    expect(screen.getAllByText('Apply')).toHaveLength(1);
  });

  it('keeps two distinct adds from the same reply as two suggestions', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('tc-1', PLANK), addCall('tc-2', PUSH_UP)]))
      .mockResolvedValueOnce(reply('Added two.'));
    await send();

    expect(text('statuses')).toBe('pending,pending');
    expect(text('errors')).toBe('|');
    expect(screen.getAllByText('Apply')).toHaveLength(2);
  });

  it('collapses a triple repeat to one suggestion and two notices', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('tc-1', PLANK), addCall('tc-2', PLANK), addCall('tc-3', PLANK)]))
      .mockResolvedValueOnce(reply('Added a plank.'));
    await send();

    expect(text('statuses')).toBe('pending,invalid,invalid');
    expect(text('errors')).toBe('|Plank is already in your workout.|Plank is already in your workout.');
    expect(screen.getAllByText('Apply')).toHaveLength(1);
  });

  it('tells the coach the repeat failed, so it does not report two additions', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('tc-1', PLANK), addCall('tc-2', PLANK)]))
      .mockResolvedValueOnce(reply('Added a plank.'));
    await send();

    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
      action_results?: { tool_call_id: string; result: { success?: boolean; message?: string } }[];
    };
    expect(body.action_results?.map(r => r.tool_call_id)).toEqual(['tc-1', 'tc-2']);
    expect(body.action_results?.[0].result.success).toBe(true);
    expect(body.action_results?.[1].result).toEqual({
      success: false,
      message: 'Plank is already in your workout.',
    });
  });

  it('rejects an exercise the live workout already holds, before any repeat', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('tc-1', BENCH)]))
      .mockResolvedValueOnce(reply('It is already there.'));
    await send();

    expect(text('statuses')).toBe('invalid');
    expect(text('errors')).toBe('Exercise is already in the workout.');
  });
});

// The guard is turn-scoped, not round-scoped: a turn runs up to three metered
// rounds, and the same addition asked for again in a later round of that turn
// is the same repeat.
describe('the same exercise added again in a later round of one turn', () => {
  beforeEach(() => {
    registerSession(liveSession([block(BENCH, 'Flat Barbell Bench Press')]));
  });

  it('is rejected as a duplicate rather than becoming a second suggestion', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('r1-1', PLANK)]))
      .mockResolvedValueOnce(toolTurn([addCall('r2-1', PLANK)]))
      .mockResolvedValueOnce(reply('Added a plank.'));
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text('statuses')).toBe('pending,invalid');
    expect(text('errors')).toBe('|Plank is already in your workout.');
    expect(screen.getAllByText('Apply')).toHaveLength(1);
  });

  it('still lets a later round add a different exercise', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('r1-1', PLANK)]))
      .mockResolvedValueOnce(toolTurn([addCall('r2-1', PUSH_UP)]))
      .mockResolvedValueOnce(reply('Added two.'));
    await send();

    expect(text('statuses')).toBe('pending,pending');
    expect(text('errors')).toBe('|');
  });

  // The scope boundary, stated as behaviour: the covered set lives on the turn,
  // so a second user message proposes the same unapplied addition afresh (the
  // workout has not changed, since a proposal is a projection until Apply).
  it('starts a fresh covered set on the next turn', async () => {
    mount();
    await flush();

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('t1-1', PLANK)]))
      .mockResolvedValueOnce(reply('Added a plank.'));
    await send();
    expect(text('statuses')).toBe('pending');

    fetchMock
      .mockResolvedValueOnce(toolTurn([addCall('t2-1', PLANK)]))
      .mockResolvedValueOnce(reply('Added a plank.'));
    await send();

    expect(text('statuses')).toBe('pending,pending');
    expect(text('errors')).toBe('|');
  });
});
