import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// The AI coach while a coach acts as a client: the data on screen is the
// client's, but the person typing, the account that is metered and the
// lockout are the coach's own. useCoach is the only thing that says which.

interface CoachValue {
  authUserId: string | null;
  ownerId: string | null;
  actingAs: { clientId: string; displayName: string | null } | null;
  ownTier: 'free' | 'premium' | null;
}

type Result = { data: unknown; error: unknown };

const hoisted = vi.hoisted(() => ({
  coach: null as unknown as CoachValue,
  results: {} as Record<string, Result>,
  reads: [] as { table: string; columns: string; column: string; value: unknown }[],
}));

vi.mock('@/contexts/CoachContext', () => ({
  useCoach: () => hoisted.coach,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      // The signed-in user is always the coach: a coach cannot read a client's
      // auth record, and the session they hold is their own.
      getUser: async () => ({ data: { user: { id: 'coach-1', created_at: '2025-03-01T08:00:00Z' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => {
          hoisted.reads.push({ table, columns, column, value });
          return { maybeSingle: async () => hoisted.results[table] ?? { data: null, error: null } };
        },
      }),
    }),
  },
}));

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({ exercises: [] }),
}));

import {
  ChatProvider, useChatContext, COOLDOWN_MS, DISABLE_DURATION_MS, LOCKED_OUT_MESSAGE,
} from '@/contexts/ChatContext';
import { forgetChatThreads } from '@/utils/chatThreads';
import { FREE_MONTHLY_MICROS, PREMIUM_MONTHLY_MICROS, creditsFromMicros, currentPeriodUTC } from '@/utils/credits';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { ExerciseId } from '@/types/workout';

const COACH = 'coach-1';
const ALICE = 'client-alice';
const BOB = 'client-bob';

const ownAccount = (over: Partial<CoachValue> = {}): CoachValue => ({
  authUserId: COACH, ownerId: COACH, actingAs: null, ownTier: 'free', ...over,
});
const actingFor = (clientId: string, displayName: string | null, over: Partial<CoachValue> = {}): CoachValue => ({
  authUserId: COACH, ownerId: clientId, actingAs: { clientId, displayName }, ownTier: 'free', ...over,
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
  const proposals = Object.values(chat.proposals);
  return (
    <div>
      <span data-testid="credits">{chat.creditsBalance.credits}</span>
      <span data-testid="known">{String(chat.creditsBalanceKnown)}</span>
      <span data-testid="count">{chat.messages.length}</span>
      <span data-testid="transcript">{chat.messages.map(m => `${m.role}:${m.content}`).join(' | ')}</span>
      <span data-testid="errors">{chat.consecutiveErrors}</span>
      <span data-testid="locked">{String(chat.lockedUntil > 0)}</span>
      <span data-testid="statuses">{proposals.map(p => p.status).join(',')}</span>
      <span data-testid="proposal-errors">{proposals.map(p => p.error ?? '').join('|')}</span>
      <button onClick={() => { void chat.sendMessage('hi'); }}>send</button>
      <button onClick={() => { if (proposals[0]) void chat.applyProposal(proposals[0].id); }}>apply</button>
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

const response = (status: number, body: object | Uint8Array[]) => ({
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
const failing = () => response(500, { error: 'boom' });
const toolTurn = (name: string, args: unknown) => response(200, [sse([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc-1', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  '[DONE]',
])]);

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const flush = () => act(async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
});

const text = (id: string) => screen.getByTestId(id).textContent;

const send = async () => {
  act(() => { vi.advanceTimersByTime(COOLDOWN_MS); });
  fireEvent.click(screen.getByText('send'));
  await flush();
};

interface SentBody {
  messages: { role: string; content: string }[];
  context: Record<string, unknown> & {
    user_profile: { member_since: string | null; display_name: string | null };
    coaching?: { acting_for_client: boolean; client_display_name: string | null };
    active_session?: { minimized: boolean; exercises: { exerciseId: string }[] };
  };
}
/** What the last call to the ai-coach function put in front of the model. */
const lastBody = (): SentBody => {
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  return JSON.parse(String(init.body)) as SentBody;
};

const mount = async (coach: CoachValue, storage: Storage = makeStorage()) => {
  hoisted.coach = coach;
  const view = render(<ChatProvider storage={storage}><Probe /></ChatProvider>);
  // Membership and balance are read on mount.
  await flush();
  return view;
};

const balanceRow = (freeUsed = 0) => ({
  data: { paid_balance_micros: 0, free_used_micros: freeUsed, free_period: currentPeriodUTC() },
  error: null,
});

const FREE_CREDITS = String(creditsFromMicros(FREE_MONTHLY_MICROS));
const PREMIUM_CREDITS = String(creditsFromMicros(PREMIUM_MONTHLY_MICROS));

const realConsoleError = console.error;

beforeEach(() => {
  localStorage.clear();
  // The conversations and lockouts live at module scope for the page load;
  // each test starts as a fresh page.
  forgetChatThreads();
  hoisted.reads.length = 0;
  hoisted.results = {
    user_token_balance: balanceRow(),
    profiles: { data: { created_at: '2024-06-15T12:00:00Z' }, error: null },
  };
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] !== 'Chat error:') realConsoleError(...args);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the credits balance while acting as a client', () => {
  it("is sized by the coach's own plan, not the plan on the client's profile", async () => {
    await mount(
      actingFor(ALICE, 'Alice', { ownTier: 'free' }),
      makeStorage({ profile: { subscriptionTier: 'premium' } }),
    );
    expect(text('known')).toBe('true');
    expect(text('credits')).toBe(FREE_CREDITS);
  });

  it('is the premium allowance for a premium coach acting for a free client', async () => {
    await mount(
      actingFor(ALICE, 'Alice', { ownTier: 'premium' }),
      makeStorage({ profile: { subscriptionTier: 'free' } }),
    );
    expect(text('credits')).toBe(PREMIUM_CREDITS);
  });

  it("is read from the coach's balance row, never the client's", async () => {
    await mount(actingFor(ALICE, 'Alice'));
    const balanceReads = hoisted.reads.filter(r => r.table === 'user_token_balance');
    expect(balanceReads.length).toBeGreaterThan(0);
    expect(balanceReads.every(r => r.column === 'user_id' && r.value === COACH)).toBe(true);
  });

  it("is re-read once the coach's own plan lands", async () => {
    const storage = makeStorage({ profile: { subscriptionTier: 'free' } });
    const view = await mount(actingFor(ALICE, 'Alice', { ownTier: null }), storage);
    expect(text('credits')).toBe(FREE_CREDITS);

    hoisted.coach = actingFor(ALICE, 'Alice', { ownTier: 'premium' });
    view.rerender(<ChatProvider storage={storage}><Probe /></ChatProvider>);
    await flush();
    expect(text('credits')).toBe(PREMIUM_CREDITS);
  });

  it('still follows the profile on screen on the coach\'s own account', async () => {
    await mount(ownAccount({ ownTier: 'free' }), makeStorage({ profile: { subscriptionTier: 'premium' } }));
    expect(text('credits')).toBe(PREMIUM_CREDITS);
  });
});

describe('what the model is told about who is typing', () => {
  it('marks the turn as a coach acting for the named client', async () => {
    await mount(
      actingFor(ALICE, 'Alice'),
      makeStorage({ profile: { displayName: 'Alice Smith' } }),
    );
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();

    const { context } = lastBody();
    expect(context.coaching).toEqual({ acting_for_client: true, client_display_name: 'Alice Smith' });
    // The profile is still the client's: that is whose data the model reads.
    expect(context.user_profile.display_name).toBe('Alice Smith');
  });

  it("falls back to the link's name when the client's profile has none", async () => {
    await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();
    expect(lastBody().context.coaching).toEqual({ acting_for_client: true, client_display_name: 'Alice' });
  });

  it('sends a null name rather than inventing one', async () => {
    await mount(actingFor(ALICE, null));
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();
    expect(lastBody().context.coaching).toEqual({ acting_for_client: true, client_display_name: null });
  });

  it('says nothing about coaching on the coach\'s own account', async () => {
    await mount(ownAccount(), makeStorage({ profile: { displayName: 'Coach Carol' } }));
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();
    expect('coaching' in lastBody().context).toBe(false);
  });
});

describe('member since', () => {
  it("is the client's sign-up date, read from their profile row", async () => {
    await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();

    expect(lastBody().context.user_profile.member_since).toBe('2024-06-15');
    expect(hoisted.reads).toContainEqual({ table: 'profiles', columns: 'created_at', column: 'user_id', value: ALICE });
  });

  it("is never the coach's own sign-up date when the client's cannot be read", async () => {
    hoisted.results.profiles = { data: null, error: null };
    await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();
    expect(lastBody().context.user_profile.member_since).toBeNull();
  });

  it("is the signed-in user's own on their own account", async () => {
    await mount(ownAccount());
    fetchMock.mockResolvedValueOnce(reply('Hi.'));
    await send();

    expect(lastBody().context.user_profile.member_since).toBe('2025-03-01');
    expect(hoisted.reads.some(r => r.table === 'profiles')).toBe(false);
  });
});

describe('the conversation across an identity switch', () => {
  it('comes back for the same coach and client after a switch away and back', async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('Hello Alice.'));
    await send();
    expect(text('transcript')).toBe('user:hi | assistant:Hello Alice.');
    first.unmount();
    (await mount(ownAccount())).unmount();

    await mount(actingFor(ALICE, 'Alice'));
    expect(text('transcript')).toBe('user:hi | assistant:Hello Alice.');

    // It is the model's history too, not just what is on screen.
    fetchMock.mockResolvedValueOnce(reply('Again.'));
    await send();
    expect(lastBody().messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello Alice.' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('never shows under another client, the coach\'s own account, or another signed-in user', async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('About Alice.'));
    await send();
    first.unmount();

    const bob = await mount(actingFor(BOB, 'Bob'));
    expect(text('count')).toBe('0');
    bob.unmount();

    const own = await mount(ownAccount());
    expect(text('count')).toBe('0');
    own.unmount();

    const otherCoach = await mount(actingFor(ALICE, 'Alice', { authUserId: 'coach-2' }));
    expect(text('count')).toBe('0');
    otherCoach.unmount();

    await mount(actingFor(ALICE, 'Alice'));
    expect(text('transcript')).toBe('user:hi | assistant:About Alice.');
  });

  it('keeps each account\'s thread separately when both are written to', async () => {
    const alice = await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('For Alice.'));
    await send();
    alice.unmount();

    const own = await mount(ownAccount());
    fetchMock.mockResolvedValueOnce(reply('For me.'));
    await send();
    own.unmount();

    const back = await mount(actingFor(ALICE, 'Alice'));
    expect(text('transcript')).toBe('user:hi | assistant:For Alice.');
    back.unmount();

    await mount(ownAccount());
    expect(text('transcript')).toBe('user:hi | assistant:For me.');
  });

  it('brings back a card whose apply was in flight as pending, not stuck applying', async () => {
    const storage = makeStorage({
      templates: [{ id: 't1', name: 'Push', exercises: [] }],
      // The write never resolves before the switch.
      deleteTemplate: vi.fn(() => new Promise<boolean>(() => {})),
    });
    const first = await mount(actingFor(ALICE, 'Alice'), storage);
    fetchMock
      .mockResolvedValueOnce(toolTurn('delete_template', { templateId: 't1' }))
      .mockResolvedValueOnce(reply('Proposed.'));
    await send();
    expect(text('statuses')).toBe('pending');

    fireEvent.click(screen.getByText('apply'));
    await flush();
    expect(text('statuses')).toBe('applying');
    first.unmount();
    (await mount(ownAccount())).unmount();

    await mount(actingFor(ALICE, 'Alice'), storage);
    expect(text('statuses')).toBe('pending');
  });

  it('starts afresh when remounted under the same account (a crash reset), not with the state it crashed in', async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('Hello Alice.'));
    await send();
    first.unmount();

    await mount(actingFor(ALICE, 'Alice'));
    expect(text('count')).toBe('0');
  });
});

describe('the lockout across an identity switch', () => {
  const lockOutNow = async () => {
    fetchMock.mockResolvedValue(failing());
    await send();
    await send();
    expect(text('locked')).toBe('true');
  };

  it('survives a remount into another account: switching is not a way around it', async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    await lockOutNow();
    const callsBefore = fetchMock.mock.calls.length;
    first.unmount();

    await mount(ownAccount());
    expect(text('locked')).toBe('true');
    expect(text('errors')).toBe('2');

    await send();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('still lifts at the time it was set for, after the remount', async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    await lockOutNow();
    first.unmount();

    const second = await mount(actingFor(BOB, 'Bob'));
    act(() => { vi.advanceTimersByTime(DISABLE_DURATION_MS - 1); });
    expect(text('locked')).toBe('true');
    act(() => { vi.advanceTimersByTime(1); });
    expect(text('locked')).toBe('false');
    expect(text('errors')).toBe('0');
    second.unmount();

    // The release is remembered too.
    await mount(actingFor(ALICE, 'Alice'));
    expect(text('locked')).toBe('false');
    expect(text('errors')).toBe('0');
  });

  it('counts a failure on each side of a switch as consecutive', async () => {
    const first = await mount(ownAccount());
    fetchMock.mockResolvedValue(failing());
    await send();
    expect(text('errors')).toBe('1');
    expect(text('locked')).toBe('false');
    first.unmount();

    await mount(actingFor(ALICE, 'Alice'));
    expect(text('errors')).toBe('1');
    await send();
    expect(text('locked')).toBe('true');
    expect(text('transcript')).toContain(LOCKED_OUT_MESSAGE);
  });

  it("is the signed-in user's own: another account on the device is not locked", async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    await lockOutNow();
    first.unmount();

    await mount(ownAccount({ authUserId: 'coach-2', ownerId: 'coach-2' }));
    expect(text('locked')).toBe('false');
    expect(text('errors')).toBe('0');
  });
});

describe('forgetChatThreads (sign-out)', () => {
  it('drops both the conversations and the lockout', async () => {
    const first = await mount(actingFor(ALICE, 'Alice'));
    fetchMock.mockResolvedValueOnce(reply('Hello.'));
    await send();
    fetchMock.mockResolvedValue(failing());
    await send();
    await send();
    expect(text('locked')).toBe('true');
    first.unmount();

    forgetChatThreads();

    await mount(actingFor(ALICE, 'Alice'));
    expect(text('count')).toBe('0');
    expect(text('locked')).toBe('false');
    expect(text('errors')).toBe('0');
  });
});

describe('a minimized workout and whose it is', () => {
  const BENCH = 'flat-barbell-bench-press' as ExerciseId;
  const PLANK = 'plank' as ExerciseId;

  const writeCache = (over: Partial<ActiveSessionCache> = {}) => {
    const cache: ActiveSessionCache = {
      blocks: [{
        exerciseId: BENCH,
        exerciseName: 'Flat Barbell Bench Press',
        restSeconds: 90,
        sets: [{ setNumber: 1, weight: '60', reps: '8', completed: false, type: 'normal', rpe: '', time: '' }],
      }],
      workoutName: 'Push Day',
      startTimestamp: 1_700_000_000_000,
      trueStartTimestamp: 1_700_000_000_000,
      elapsedAtCache: 120,
      templateId: 't1',
      ...over,
    };
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cache));
  };

  const sentSession = async () => {
    fetchMock.mockResolvedValueOnce(reply('Noted.'));
    await send();
    return lastBody().context.active_session;
  };

  it("is not described to the coach while acting for a client when it is the coach's own", async () => {
    writeCache({ ownerUserId: COACH });
    await mount(actingFor(ALICE, 'Alice'));
    expect(await sentSession()).toBeUndefined();
  });

  it("is not described when it belongs to a different client", async () => {
    writeCache({ ownerUserId: BOB });
    await mount(actingFor(ALICE, 'Alice'));
    expect(await sentSession()).toBeUndefined();
  });

  it("is not described on the coach's own account when it is a client's", async () => {
    writeCache({ ownerUserId: ALICE });
    await mount(ownAccount());
    expect(await sentSession()).toBeUndefined();
  });

  it('treats a cache from before coach mode as the signed-in user\'s', async () => {
    writeCache();
    const acting = await mount(actingFor(ALICE, 'Alice'));
    expect(await sentSession()).toBeUndefined();
    acting.unmount();

    await mount(ownAccount());
    expect(await sentSession()).toMatchObject({ minimized: true });
  });

  it('is described when it belongs to the account on screen', async () => {
    writeCache({ ownerUserId: ALICE });
    await mount(actingFor(ALICE, 'Alice'));
    const session = await sentSession();
    expect(session).toMatchObject({ minimized: true });
    expect(session!.exercises.map(e => e.exerciseId)).toEqual([BENCH]);
  });

  it("refuses a workout tool against another account's workout and leaves the cache alone", async () => {
    writeCache({ ownerUserId: COACH });
    const before = localStorage.getItem(ACTIVE_SESSION_CACHE_KEY);
    await mount(actingFor(ALICE, 'Alice'));

    fetchMock
      .mockResolvedValueOnce(toolTurn('add_exercise_to_workout', { exerciseId: PLANK }))
      .mockResolvedValueOnce(reply('Done.'));
    await send();

    expect(text('statuses')).toBe('invalid');
    expect(text('proposal-errors')).toBe('No active workout session. Start a workout first.');
    expect(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY)).toBe(before);
  });
});
