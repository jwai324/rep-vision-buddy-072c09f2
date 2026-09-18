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
  ChatProvider, useChatContext,
  COOLDOWN_MS, DISABLE_DURATION_MS, STREAM_INACTIVITY_MS,
  LOCKED_OUT_MESSAGE, STALLED_STREAM_MESSAGE,
} from '@/contexts/ChatContext';

const storage = {
  templates: [], programs: [], history: [], bodyMeasurements: [],
  profile: {}, preferences: {}, activeProgramId: null,
};

const Probe: React.FC = () => {
  const chat = useChatContext();
  const last = chat.messages[chat.messages.length - 1];
  return (
    <div>
      <span data-testid="loading">{String(chat.isLoading)}</span>
      <span data-testid="errors">{chat.consecutiveErrors}</span>
      <span data-testid="locked">{String(chat.lockedUntil > 0)}</span>
      <span data-testid="count">{chat.messages.length}</span>
      <span data-testid="last">{last?.content ?? ''}</span>
      <button onClick={() => { void chat.sendMessage('hi'); }}>send</button>
      <button onClick={chat.clearChat}>clear</button>
    </div>
  );
};

const encoder = new TextEncoder();
const sse = (events: (object | string)[]) =>
  encoder.encode(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n`).join(''));

const HANG = Symbol('hang');
type Chunk = Uint8Array | typeof HANG;

/** A body reader fed from a script; HANG is a read that never resolves. */
function readerOf(chunks: Chunk[]) {
  let i = 0;
  return {
    read: () => {
      const c = chunks[i++];
      if (c === HANG) return new Promise<never>(() => {});
      if (!c) return Promise.resolve({ done: true as const, value: undefined });
      return Promise.resolve({ done: false as const, value: c });
    },
  };
}

const response = (status: number, body: object | Chunk[]) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (Array.isArray(body) ? {} : body),
  body: { getReader: () => readerOf(Array.isArray(body) ? body : []) },
}) as unknown as Response;

const failing = () => response(500, { error: 'boom' });
const reply = (text: string) => response(200, [sse([
  { choices: [{ delta: { content: text }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  '[DONE]',
])]);

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const signalOf = (call: number) => fetchMock.mock.calls[call][1]?.signal as AbortSignal;

/** Lets the async turn run through its awaits; nothing here waits on a timer. */
const flush = () => act(async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
});

const send = async () => {
  // Sends are rate-limited; the clock has to move on between them.
  act(() => { vi.advanceTimersByTime(COOLDOWN_MS); });
  fireEvent.click(screen.getByText('send'));
  await flush();
};

const text = (id: string) => screen.getByTestId(id).textContent;

const realConsoleError = console.error;

beforeEach(async () => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The turns under test fail on purpose; the coach logs each one.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] !== 'Chat error:') realConsoleError(...args);
  });
  render(
    <ChatProvider storage={storage}>
      <Probe />
    </ChatProvider>
  );
  // The provider fetches membership and balance on mount.
  await flush();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AI coach lockout', () => {
  it('locks after two consecutive failures and releases exactly when the five minutes are up', async () => {
    fetchMock.mockResolvedValue(failing());

    await send();
    expect(text('errors')).toBe('1');
    expect(text('locked')).toBe('false');
    expect(text('last')).toContain('Something went wrong: boom');

    await send();
    expect(text('errors')).toBe('2');
    expect(text('locked')).toBe('true');
    expect(text('last')).toBe(LOCKED_OUT_MESSAGE);
    expect(text('loading')).toBe('false');

    await send();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => { vi.advanceTimersByTime(DISABLE_DURATION_MS - COOLDOWN_MS - 1); });
    expect(text('locked')).toBe('true');

    act(() => { vi.advanceTimersByTime(1); });
    expect(text('locked')).toBe('false');
    expect(text('errors')).toBe('0');

    fetchMock.mockResolvedValue(reply('Back.'));
    await send();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text('last')).toBe('Back.');
    expect(text('errors')).toBe('0');
  });

  it('counts a stream that fails after a good status from the current count, not a stale one', async () => {
    fetchMock.mockResolvedValueOnce(failing());
    await send();
    expect(text('errors')).toBe('1');

    fetchMock.mockResolvedValueOnce(response(200, [sse([{ error: 'Upstream ran out of credit.' }])]));
    await send();
    expect(text('last')).toBe('Upstream ran out of credit.');
    expect(text('errors')).toBe('1');
    expect(text('locked')).toBe('false');
  });

  it('shows the server sentence on a 413 and neither locks nor retries', async () => {
    const sentence = 'A message in this request is too long.';
    fetchMock.mockResolvedValue(response(413, { error: sentence }));

    await send();
    expect(text('last')).toBe(sentence);
    expect(text('errors')).toBe('0');
    expect(text('locked')).toBe('false');
    expect(text('loading')).toBe('false');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await send();
    await send();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text('errors')).toBe('0');
    expect(text('locked')).toBe('false');
  });

  it('gives up on a stalled stream, says so, and does not count it', async () => {
    fetchMock.mockResolvedValueOnce(response(200, [
      sse([{ choices: [{ delta: { content: 'Let me' }, finish_reason: null }] }]),
      HANG,
    ]));

    await send();
    expect(text('loading')).toBe('true');
    expect(text('last')).toBe('Let me');

    act(() => { vi.advanceTimersByTime(STREAM_INACTIVITY_MS - 1); });
    expect(text('loading')).toBe('true');

    act(() => { vi.advanceTimersByTime(1); });
    await flush();
    expect(signalOf(0).aborted).toBe(true);
    expect(text('loading')).toBe('false');
    expect(text('last')).toBe(STALLED_STREAM_MESSAGE);
    expect(text('errors')).toBe('0');
    expect(text('locked')).toBe('false');

    fetchMock.mockResolvedValueOnce(reply('Still here.'));
    await send();
    expect(text('last')).toBe('Still here.');
  });

  it('ends the turn in flight and lifts the lockout when the chat is cleared', async () => {
    fetchMock.mockResolvedValue(failing());
    await send();
    await send();
    expect(text('locked')).toBe('true');

    fireEvent.click(screen.getByText('clear'));
    expect(text('locked')).toBe('false');
    expect(text('errors')).toBe('0');
    expect(text('count')).toBe('0');

    fetchMock.mockResolvedValueOnce(response(200, [HANG]));
    await send();
    expect(text('loading')).toBe('true');
    expect(text('count')).toBe('2');

    fireEvent.click(screen.getByText('clear'));
    await flush();
    expect(signalOf(2).aborted).toBe(true);
    expect(text('loading')).toBe('false');
    expect(text('count')).toBe('0');
    expect(text('errors')).toBe('0');
  });

  it('passes one abort signal to both the first and the follow-up fetch', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, [sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'delete_template', arguments: '{"templateId":"nope"}' } }] }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ])]))
      .mockResolvedValueOnce(reply('That template does not exist.'));

    await send();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signalOf(0)).toBeInstanceOf(AbortSignal);
    expect(signalOf(1)).toBe(signalOf(0));
    expect(signalOf(0).aborted).toBe(false);
    expect(text('loading')).toBe('false');
    expect(text('last')).toBe('That template does not exist.');
  });
});
