import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// postgrest-js resolves { data, error } rather than throwing, so the balance
// read's outcome is whatever this holds when the provider asks for it.
const hoisted = vi.hoisted(() => ({
  balance: { data: null as unknown, error: null as unknown },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', created_at: '2026-01-01T00:00:00Z' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => hoisted.balance }),
      }),
    }),
  },
}));

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({ exercises: [] }),
}));

import { ChatProvider, useChatContext, COOLDOWN_MS } from '@/contexts/ChatContext';
import { FREE_MONTHLY_MICROS, creditsFromMicros, currentPeriodUTC } from '@/utils/credits';

const storage = {
  templates: [],
  programs: [],
  futureWorkouts: [],
  history: [],
  bodyMeasurements: [],
  profile: {},
  preferences: {},
  activeProgramId: null,
  dataTrusted: true,
};

const Probe: React.FC = () => {
  const chat = useChatContext();
  return (
    <div>
      <span data-testid="credits">{chat.creditsBalance.credits}</span>
      <span data-testid="exhausted">{String(chat.creditsBalance.exhausted)}</span>
      <span data-testid="known">{String(chat.creditsBalanceKnown)}</span>
      <button onClick={() => { void chat.refreshBalance(); }}>refresh</button>
      <button onClick={() => { void chat.sendMessage('go'); }}>send</button>
    </div>
  );
};

const spent = (micros: number) => ({
  data: { paid_balance_micros: 0, free_used_micros: micros, free_period: currentPeriodUTC() },
  error: null,
});
const failedRead = { data: null, error: { message: 'FetchError: network request failed' } };

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const flush = () => act(async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
});

const text = (id: string) => screen.getByTestId(id).textContent;

const refresh = async () => {
  fireEvent.click(screen.getByText('refresh'));
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The failed read is logged; the test is about what the balance does after.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  hoisted.balance = { data: null, error: null };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a balance read that fails', () => {
  it('leaves an exhausted user exhausted instead of painting a full allowance', async () => {
    hoisted.balance = spent(FREE_MONTHLY_MICROS);
    render(<ChatProvider storage={storage}><Probe /></ChatProvider>);
    await flush();
    expect(text('exhausted')).toBe('true');
    expect(text('credits')).toBe('0');
    expect(text('known')).toBe('true');

    hoisted.balance = failedRead;
    await refresh();

    expect(text('exhausted')).toBe('true');
    expect(text('credits')).toBe('0');
    expect(text('known')).toBe('true');
  });

  it('keeps Send blocked for a user already known to be out of credits', async () => {
    hoisted.balance = spent(FREE_MONTHLY_MICROS);
    render(<ChatProvider storage={storage}><Probe /></ChatProvider>);
    await flush();

    hoisted.balance = failedRead;
    await refresh();

    act(() => { vi.advanceTimersByTime(COOLDOWN_MS); });
    fireEvent.click(screen.getByText('send'));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the balance unknown when no read has ever succeeded', async () => {
    hoisted.balance = failedRead;
    render(<ChatProvider storage={storage}><Probe /></ChatProvider>);
    await flush();
    expect(text('known')).toBe('false');

    hoisted.balance = spent(0);
    await refresh();
    expect(text('known')).toBe('true');
    expect(text('credits')).toBe(String(creditsFromMicros(FREE_MONTHLY_MICROS)));
  });
});
