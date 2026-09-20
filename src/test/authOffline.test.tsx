import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';
import { writeStorageCache, readStorageCache, type CachedStorage } from '@/utils/storageCache';

type AuthCallback = (event: string, session: Session | null) => void;
let emit: AuthCallback;

/** What the next `getSession()` resolves with, or throws. */
let getSessionResult: { data: { session: Session | null }; error?: unknown } = {
  data: { session: null },
  error: null,
};
let getSessionThrows: unknown = null;
let getSessionCalls = 0;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => {
        getSessionCalls += 1;
        if (getSessionThrows) return Promise.reject(getSessionThrows);
        return Promise.resolve(getSessionResult);
      },
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

const { AuthProvider, useAuth } = await import('@/contexts/AuthContext');

const USER_ID = 'offline-user';

const storedUser = { id: USER_ID, updated_at: '2026-09-01T00:00:00Z' } as User;
const storedSession = {
  access_token: 'expired-jwt',
  refresh_token: 'refresh-abc',
  expires_at: 1,
  token_type: 'bearer',
  user: storedUser,
} as unknown as Session;

/** auth-js leaves the session under its own key for a failure it can retry. */
const seedStoredSession = () =>
  localStorage.setItem('sb-testproj-auth-token', JSON.stringify(storedSession));

/** A refresh that never got an answer it could use. */
const unreachableError = Object.assign(new Error('Failed to fetch'), {
  name: 'AuthRetryableFetchError',
  status: 0,
  __isAuthError: true,
});

/** A refresh token the server refused. */
const refusedError = Object.assign(new Error('Invalid Refresh Token: Already Used'), {
  name: 'AuthApiError',
  status: 400,
  code: 'refresh_token_already_used',
  __isAuthError: true,
});

const Probe: React.FC = () => {
  const { user, loading, reconnecting } = useAuth();
  return (
    <span data-testid="state">{loading ? 'loading' : `${user?.id ?? 'none'}:${reconnecting ? 'reconnecting' : 'settled'}`}</span>
  );
};

const snapshot: CachedStorage = {
  history: [], templates: [], programs: [], activeProgramId: null, futureWorkouts: [],
  preferences: {
    weightUnit: 'kg', defaultRestSeconds: 90, defaultDropSetsEnabled: false,
    streakMode: 'daily', streakWeeklyTarget: 3, streakAdjustment: 0,
    streakAdjustmentSetAt: null, tutorialCompleted: true, hideTimers: false,
    customLocations: [], stickyNotes: {},
  },
  profile: {
    displayName: null, goal: null, hybridGoals: [], coachNotes: null,
    experienceLevel: null, equipment: [], injuries: [], age: null,
    sex: null, heightCm: null, subscriptionTier: 'premium',
  },
  bodyMeasurements: [],
};

const mountAndSettle = async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  localStorage.clear();
  getSessionResult = { data: { session: null }, error: null };
  getSessionThrows = null;
  getSessionCalls = 0;
});

// Opening the app with no connection used to look exactly like being signed
// out, and dropped the user on a sign-in screen they could not use.
describe('a session check that cannot reach Auth', () => {
  it('keeps the user signed in and says it is reconnecting', async () => {
    seedStoredSession();
    getSessionResult = { data: { session: null }, error: unreachableError };

    await mountAndSettle();

    expect(screen.getByTestId('state')).toHaveTextContent(`${USER_ID}:reconnecting`);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  });

  it('leaves the locally cached data where it is', async () => {
    seedStoredSession();
    writeStorageCache(USER_ID, snapshot);
    getSessionResult = { data: { session: null }, error: unreachableError };

    await mountAndSettle();

    expect(readStorageCache(USER_ID)).not.toBeNull();
  });

  it('treats a rejected check the same way — a refusal is always a resolved value', async () => {
    seedStoredSession();
    getSessionThrows = new Error('navigator.locks timed out');

    await mountAndSettle();

    expect(screen.getByTestId('state')).toHaveTextContent(`${USER_ID}:reconnecting`);
  });

  it('ignores the empty INITIAL_SESSION auth-js emits alongside it', async () => {
    seedStoredSession();
    getSessionResult = { data: { session: null }, error: unreachableError };
    await mountAndSettle();

    await act(async () => { emit('INITIAL_SESSION', null); });

    expect(screen.getByTestId('state')).toHaveTextContent(`${USER_ID}:reconnecting`);
  });

  it('settles as soon as a refresh gets through', async () => {
    seedStoredSession();
    getSessionResult = { data: { session: null }, error: unreachableError };
    await mountAndSettle();

    const fresh = { ...storedSession, access_token: 'fresh-jwt' } as Session;
    await act(async () => { emit('TOKEN_REFRESHED', fresh); });

    expect(screen.getByTestId('state')).toHaveTextContent(`${USER_ID}:settled`);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('retries by itself when the connection comes back', async () => {
    seedStoredSession();
    getSessionResult = { data: { session: null }, error: unreachableError };
    await mountAndSettle();
    const before = getSessionCalls;

    getSessionResult = { data: { session: storedSession }, error: null };
    await act(async () => { window.dispatchEvent(new Event('online')); });

    await waitFor(() => expect(getSessionCalls).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(`${USER_ID}:settled`));
  });
});

describe('a login the server actually refused', () => {
  it('signs out immediately even with a session still on disk', async () => {
    // auth-js removes the stored session for a refusal; a client that has not
    // got there yet must not be read as merely offline.
    seedStoredSession();
    getSessionResult = { data: { session: null }, error: refusedError };

    await mountAndSettle();

    expect(screen.getByTestId('state')).toHaveTextContent('none:settled');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('signs out when there is no stored session to fall back on', async () => {
    getSessionResult = { data: { session: null }, error: unreachableError };

    await mountAndSettle();

    expect(screen.getByTestId('state')).toHaveTextContent('none:settled');
  });

  it('still signs out on SIGNED_OUT while reconnecting', async () => {
    seedStoredSession();
    writeStorageCache(USER_ID, snapshot);
    getSessionResult = { data: { session: null }, error: unreachableError };
    await mountAndSettle();

    await act(async () => { emit('SIGNED_OUT', null); });

    expect(screen.getByTestId('state')).toHaveTextContent('none:settled');
    expect(readStorageCache(USER_ID)).toBeNull();
  });
});
