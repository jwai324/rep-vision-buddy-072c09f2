import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import {
  ACTIVE_SESSION_CACHE_KEY, COACH_STORAGE_PREFIX, USER_DRAFT_KEYS,
  clearLocalDrafts, ownerDraftKey,
} from '@/utils/localDrafts';
import { queuePendingTemplate, readPendingTemplates } from '@/utils/pendingTemplateWrites';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { CoachContextValue } from '@/contexts/CoachContext';

const COACH = 'coach-1';
const ALEX = 'client-alex';
const BEA = 'client-bea';

type RpcAnswer = { data: unknown; error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  rpc: vi.fn(),
  /** What list_my_clients answers; a function lets a test hold the answer back. */
  listAnswer: null as null | (() => Promise<RpcAnswer>),
  sessionActive: false,
  profileReads: [] as unknown[][],
}));

vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => mocks.toastError(...a), success: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'coach-1' }, session: null, loading: false, signOut: vi.fn() }),
}));

vi.mock('@/hooks/useSessionController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSessionController')>();
  return { ...actual, isSessionActive: () => mocks.sessionActive };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string) => mocks.rpc(name),
    from: (table: string) => {
      const chain: unknown[][] = [];
      mocks.profileReads.push(chain);
      const builder = {
        select: (...a: unknown[]) => { chain.push(['select', ...a]); return builder; },
        eq: (...a: unknown[]) => { chain.push(['eq', ...a]); return builder; },
        maybeSingle: () => Promise.resolve(
          table === 'profiles'
            ? { data: { subscription_tier: 'premium' }, error: null }
            : { data: null, error: null },
        ),
      };
      return builder;
    },
  },
}));

const { CoachProvider, useCoach, useOwnerDraftKey, SWITCH_BLOCKED_MESSAGE } = await import('@/contexts/CoachContext');

const actingKey = (authUserId: string) => `${COACH_STORAGE_PREFIX}acting:${authUserId}`;

const clientRow = (clientId: string, displayName: string) => ({
  link_id: `link-${clientId}`, client_id: clientId, display_name: displayName, linked_at: '2026-10-01T00:00:00.000Z',
});

const listed = (...rows: ReturnType<typeof clientRow>[]) => () => Promise.resolve({ data: rows, error: null });

const persistActing = (authUserId: string, clientId: string, displayName: string | null) =>
  localStorage.setItem(actingKey(authUserId), JSON.stringify({ clientId, displayName }));

/** A workout in progress on this device, as ActiveSession writes it. */
const workoutFor = (owner?: string) => {
  const cache: ActiveSessionCache = {
    blocks: [], workoutName: 'Leg Day', startTimestamp: Date.now(), elapsedAtCache: 0,
    ...(owner ? { ownerUserId: owner } : {}),
  };
  localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cache));
};

let ctx: CoachContextValue;
let draftKey: string;
const Probe = () => {
  ctx = useCoach();
  draftKey = useOwnerDraftKey('template_builder_draft');
  return null;
};

/** Mounts the provider and lets its first list_my_clients answer land. */
const mount = async () => {
  const utils = render(<CoachProvider authUserId={COACH}><Probe /></CoachProvider>);
  await act(async () => {});
  return utils;
};

const listCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'list_my_clients').length;

beforeEach(() => {
  localStorage.clear();
  mocks.toastError.mockReset();
  mocks.sessionActive = false;
  mocks.profileReads.length = 0;
  mocks.listAnswer = listed(clientRow(ALEX, 'Alex'), clientRow(BEA, 'Bea'));
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((name: string) =>
    name === 'list_my_clients' && mocks.listAnswer ? mocks.listAnswer() : Promise.resolve({ data: null, error: null }));
});

describe('CoachProvider: the identity a cold start resumes in', () => {
  it('starts as the signed-in user when nothing says otherwise', async () => {
    await mount();

    expect(ctx.authUserId).toBe(COACH);
    expect(ctx.ownerId).toBe(COACH);
    expect(ctx.actingAs).toBeNull();
    expect(ctx.clientsLoaded).toBe(true);
    expect(ctx.clients.map(c => c.clientId)).toEqual([ALEX, BEA]);
  });

  it('resumes the client last opened on this device', async () => {
    persistActing(COACH, ALEX, 'Alex');
    await mount();

    expect(ctx.ownerId).toBe(ALEX);
    expect(ctx.actingAs).toEqual({ clientId: ALEX, displayName: 'Alex' });
    expect(draftKey).toBe(`template_builder_draft:${ALEX}`);
  });

  it('lets the workout in progress decide over the persisted choice', async () => {
    // The workout was started for Alex; resuming as Bea (or the coach) could
    // only save it into the wrong account.
    persistActing(COACH, BEA, 'Bea');
    workoutFor(ALEX);
    await mount();

    expect(ctx.ownerId).toBe(ALEX);
    // The persisted name belongs to someone else and is not borrowed.
    expect(ctx.actingAs).toEqual({ clientId: ALEX, displayName: 'Alex' });
  });

  it('takes the persisted name only when it is the same client as the workout\'s', async () => {
    mocks.listAnswer = () => new Promise(() => {});
    persistActing(COACH, BEA, 'Bea');
    workoutFor(ALEX);
    await mount();
    expect(ctx.actingAs).toEqual({ clientId: ALEX, displayName: null });
  });

  it('resumes the coach when the workout in progress is the coach\'s own', async () => {
    persistActing(COACH, ALEX, 'Alex');
    workoutFor(COACH);
    await mount();

    expect(ctx.ownerId).toBe(COACH);
    expect(ctx.actingAs).toBeNull();
    expect(draftKey).toBe('template_builder_draft');
  });

  it('reads only its own auth user\'s persisted choice', async () => {
    persistActing('coach-2', ALEX, 'Alex');
    await mount();
    expect(ctx.ownerId).toBe(COACH);
  });

  it('ignores a persisted choice that names the coach, or is not JSON', async () => {
    persistActing(COACH, COACH, 'Me');
    const first = await mount();
    expect(ctx.actingAs).toBeNull();
    first.unmount();

    localStorage.setItem(actingKey(COACH), '{not json');
    await mount();
    expect(ctx.actingAs).toBeNull();
  });

  it('persists a switch under the auth user\'s key and forgets it on the way back', async () => {
    await mount();

    let ok = false;
    act(() => { ok = ctx.actAs({ clientId: ALEX, displayName: 'Alex' }); });
    expect(ok).toBe(true);
    expect(ctx.ownerId).toBe(ALEX);
    expect(JSON.parse(localStorage.getItem(actingKey(COACH)) ?? 'null')).toEqual({ clientId: ALEX, displayName: 'Alex' });

    act(() => { ok = ctx.stopActing(); });
    expect(ok).toBe(true);
    expect(ctx.ownerId).toBe(COACH);
    expect(localStorage.getItem(actingKey(COACH))).toBeNull();
  });

  it('treats acting as the coach\'s own id as stopping', async () => {
    persistActing(COACH, ALEX, 'Alex');
    await mount();

    act(() => { ctx.actAs({ clientId: COACH, displayName: 'Me' }); });
    expect(ctx.actingAs).toBeNull();
    expect(localStorage.getItem(actingKey(COACH))).toBeNull();
  });

  it('meters on the coach\'s own plan even while acting as a client', async () => {
    persistActing(COACH, ALEX, 'Alex');
    await mount();

    await waitFor(() => expect(ctx.ownTier).toBe('premium'));
    expect(mocks.profileReads).toHaveLength(1);
    expect(mocks.profileReads[0]).toContainEqual(['eq', 'user_id', COACH]);
  });
});

describe('CoachProvider: switching while a workout is in progress', () => {
  it('refuses to leave the coach\'s own workout for a client', async () => {
    workoutFor(COACH);
    await mount();

    let ok = true;
    act(() => { ok = ctx.actAs({ clientId: ALEX, displayName: 'Alex' }); });

    expect(ok).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(SWITCH_BLOCKED_MESSAGE);
    expect(ctx.ownerId).toBe(COACH);
    expect(localStorage.getItem(actingKey(COACH))).toBeNull();
  });

  it('refuses to leave a client\'s workout, for the coach or for another client', async () => {
    workoutFor(ALEX);
    await mount();
    expect(ctx.ownerId).toBe(ALEX);

    let ok = true;
    act(() => { ok = ctx.actAs({ clientId: BEA, displayName: 'Bea' }); });
    expect(ok).toBe(false);
    act(() => { ok = ctx.stopActing(); });
    expect(ok).toBe(false);

    expect(ctx.ownerId).toBe(ALEX);
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
  });

  it('allows switching to the identity the workout belongs to', async () => {
    await mount();
    // Started in another tab left in Alex's account.
    workoutFor(ALEX);

    let ok = false;
    act(() => { ok = ctx.actAs({ clientId: ALEX, displayName: 'Alex' }); });
    expect(ok).toBe(true);
    expect(ctx.ownerId).toBe(ALEX);

    // And from there, nowhere else until it ends.
    act(() => { ok = ctx.stopActing(); });
    expect(ok).toBe(false);
    expect(ctx.ownerId).toBe(ALEX);
  });

  it('reads a cache from before coach mode as the coach\'s own workout', async () => {
    persistActing(COACH, ALEX, 'Alex');
    await mount();
    workoutFor(undefined);

    let ok = true;
    act(() => { ok = ctx.actAs({ clientId: BEA, displayName: 'Bea' }); });
    expect(ok).toBe(false);
    act(() => { ok = ctx.stopActing(); });
    expect(ok).toBe(true);
    expect(ctx.ownerId).toBe(COACH);
  });

  it('counts a mounted workout that has not written its cache yet as this identity\'s', async () => {
    await mount();
    mocks.sessionActive = true;

    let ok = true;
    act(() => { ok = ctx.actAs({ clientId: ALEX, displayName: 'Alex' }); });
    expect(ok).toBe(false);
    expect(ctx.ownerId).toBe(COACH);
  });

  it('is not held back by a workout whose owner the coach can no longer reach', async () => {
    mocks.listAnswer = listed(clientRow(BEA, 'Bea'));
    await mount();
    // Alex ended the link mid-workout: there is no identity left to protect
    // the workout for, and Index offers to keep or discard it instead.
    workoutFor(ALEX);

    let ok = false;
    act(() => { ok = ctx.actAs({ clientId: BEA, displayName: 'Bea' }); });
    expect(ok).toBe(true);
    expect(ctx.ownerId).toBe(BEA);
    act(() => { ok = ctx.stopActing(); });
    expect(ok).toBe(true);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('still protects a client\'s workout before the client list has answered', async () => {
    mocks.listAnswer = () => new Promise(() => {});
    await mount();
    workoutFor(ALEX);

    let ok = true;
    act(() => { ok = ctx.actAs({ clientId: BEA, displayName: 'Bea' }); });
    expect(ok).toBe(false);
    expect(ctx.ownerId).toBe(COACH);
  });

  it('still protects it after a failed list read', async () => {
    mocks.listAnswer = () => Promise.resolve({ data: null, error: { message: 'offline' } });
    await mount();
    workoutFor(ALEX);

    let ok = true;
    act(() => { ok = ctx.actAs({ clientId: BEA, displayName: 'Bea' }); });
    expect(ok).toBe(false);
  });
});

describe('CoachProvider: the client list', () => {
  it('exits a client the list no longer names, and drops only that client\'s queued writes', async () => {
    persistActing(COACH, ALEX, 'Alex');
    queuePendingTemplate(ALEX, { id: 't-alex', name: 'Alex queued', exercises: [] }, null);
    queuePendingTemplate(BEA, { id: 't-bea', name: 'Bea queued', exercises: [] }, null);
    queuePendingTemplate(COACH, { id: 't-own', name: 'Own queued', exercises: [] }, null);
    await mount();
    expect(ctx.ownerId).toBe(ALEX);

    mocks.listAnswer = listed(clientRow(BEA, 'Bea'));
    await act(async () => { await ctx.refreshClients(); });

    expect(ctx.ownerId).toBe(COACH);
    expect(ctx.actingAs).toBeNull();
    expect(localStorage.getItem(actingKey(COACH))).toBeNull();
    // Keyed by the client, the queue could never replay once access is gone.
    expect(readPendingTemplates(ALEX)).toEqual([]);
    expect(readPendingTemplates(BEA).map(e => e.template.id)).toEqual(['t-bea']);
    expect(readPendingTemplates(COACH).map(e => e.template.id)).toEqual(['t-own']);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('Alex'));
  });

  it('exits on the very first answer when a resumed client is already gone', async () => {
    persistActing(COACH, ALEX, 'Alex');
    mocks.listAnswer = listed();
    await mount();

    expect(ctx.ownerId).toBe(COACH);
    expect(ctx.clientsLoaded).toBe(true);
  });

  it('keeps the identity when list_my_clients fails', async () => {
    persistActing(COACH, ALEX, 'Alex');
    queuePendingTemplate(ALEX, { id: 't-alex', name: 'Alex queued', exercises: [] }, null);
    mocks.listAnswer = () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
    await mount();

    // Offline at the gym proves nothing about the link.
    expect(ctx.ownerId).toBe(ALEX);
    expect(ctx.clientsLoaded).toBe(false);
    expect(localStorage.getItem(actingKey(COACH))).not.toBeNull();
    expect(readPendingTemplates(ALEX)).toHaveLength(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('picks up a renamed client\'s new name, on screen and in the persisted choice', async () => {
    persistActing(COACH, ALEX, 'Alex');
    mocks.listAnswer = listed(clientRow(ALEX, 'Alexandra'));
    await mount();

    expect(ctx.actingAs).toEqual({ clientId: ALEX, displayName: 'Alexandra' });
    expect(JSON.parse(localStorage.getItem(actingKey(COACH)) ?? 'null')).toEqual({ clientId: ALEX, displayName: 'Alexandra' });
  });
});

describe('CoachProvider: accessLost', () => {
  it('exits the client the data layer could not reach, drops its queue and re-reads the list', async () => {
    persistActing(COACH, ALEX, 'Alex');
    queuePendingTemplate(ALEX, { id: 't-alex', name: 'Alex queued', exercises: [] }, null);
    await mount();
    const before = listCalls();

    await act(async () => { ctx.accessLost(ALEX); });

    expect(ctx.ownerId).toBe(COACH);
    expect(localStorage.getItem(actingKey(COACH))).toBeNull();
    expect(readPendingTemplates(ALEX)).toEqual([]);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('Alex'));
    expect(listCalls()).toBe(before + 1);
  });

  it('ignores a client it is not acting as', async () => {
    persistActing(COACH, ALEX, 'Alex');
    queuePendingTemplate(BEA, { id: 't-bea', name: 'Bea queued', exercises: [] }, null);
    await mount();

    await act(async () => { ctx.accessLost(BEA); });

    expect(ctx.ownerId).toBe(ALEX);
    expect(readPendingTemplates(BEA)).toHaveLength(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

describe('clearLocalDrafts and coach mode', () => {
  it('keeps a client\'s drafts under <key>:<clientId> and the coach\'s own under the bare key', () => {
    expect(ownerDraftKey('ai-chat-input-draft', ALEX)).toBe(`ai-chat-input-draft:${ALEX}`);
    expect(ownerDraftKey('ai-chat-input-draft', null)).toBe('ai-chat-input-draft');
    expect(ownerDraftKey('ai-chat-input-draft', undefined)).toBe('ai-chat-input-draft');
  });

  it('sweeps every namespaced draft and every coach key, and leaves unrelated keys', () => {
    const swept = [
      ...USER_DRAFT_KEYS,
      ...USER_DRAFT_KEYS.map(k => `${k}:${ALEX}`),
      ...USER_DRAFT_KEYS.map(k => `${k}:${BEA}`),
      actingKey(COACH),
      actingKey('coach-2'),
      `${COACH_STORAGE_PREFIX}anything-else`,
    ];
    const kept = [
      'restTimerSound',
      'template_builder_draftish',
      `x-${USER_DRAFT_KEYS[0]}:${ALEX}`,
      'repvision:coach',
      'repvision:coaching:acting',
    ];
    for (const k of [...swept, ...kept]) localStorage.setItem(k, 'x');

    clearLocalDrafts();

    for (const k of swept) expect(localStorage.getItem(k), k).toBeNull();
    for (const k of kept) expect(localStorage.getItem(k), k).toBe('x');
  });
});
