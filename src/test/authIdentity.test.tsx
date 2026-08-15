import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';

type AuthCallback = (event: string, session: Session | null) => void;
let emit: AuthCallback;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

const { AuthProvider, useAuth } = await import('@/contexts/AuthContext');

const makeUser = (id: string, updatedAt: string): User => ({
  id,
  updated_at: updatedAt,
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
} as User);

// Counted outside the tree: reading a ref during render would lag by one.
let loads = 0;

/** Stands in for the real `useEffect(..., [user])` loads across the app. */
const LoadCounter: React.FC = () => {
  const { user } = useAuth();
  useEffect(() => { loads += 1; }, [user]);
  return <span data-testid="uid">{user?.id ?? 'none'}</span>;
};

const emitSession = (user: User | null) =>
  act(async () => { emit('TOKEN_REFRESHED', user ? ({ user } as Session) : null); });

/**
 * The mocked getSession resolves a tick after mount and would otherwise land
 * on top of the first emitted event.
 */
const mountAndSettle = async (ui: React.ReactElement) => {
  render(ui);
  await act(async () => { await Promise.resolve(); });
  loads = 0;
};

beforeEach(() => { localStorage.clear(); loads = 0; });

describe('auth user identity across token refreshes', () => {
  it('does not re-run user-keyed effects when a refresh returns the same user', async () => {
    await mountAndSettle(<AuthProvider><LoadCounter /></AuthProvider>);

    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));
    const afterSignIn = loads;
    expect(screen.getByTestId('uid')).toHaveTextContent('u1');

    // The tab regains focus three times; Supabase deserializes a fresh user
    // object each time. None of them is a real change.
    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));
    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));
    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));

    expect(loads).toBe(afterSignIn);
  });

  it('still picks up a genuine profile update', async () => {
    await mountAndSettle(<AuthProvider><LoadCounter /></AuthProvider>);

    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));
    const before = loads;

    await emitSession(makeUser('u1', '2026-08-09T12:00:00Z'));

    expect(loads).toBeGreaterThan(before);
  });

  it('still switches accounts', async () => {
    await mountAndSettle(<AuthProvider><LoadCounter /></AuthProvider>);

    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));
    const before = loads;

    await emitSession(makeUser('u2', '2026-08-01T00:00:00Z'));

    expect(loads).toBeGreaterThan(before);
    expect(screen.getByTestId('uid')).toHaveTextContent('u2');
  });

  it('still reacts to signing out', async () => {
    await mountAndSettle(<AuthProvider><LoadCounter /></AuthProvider>);

    await emitSession(makeUser('u1', '2026-08-01T00:00:00Z'));
    const before = loads;

    await emitSession(null);

    expect(loads).toBeGreaterThan(before);
    expect(screen.getByTestId('uid')).toHaveTextContent('none');
  });
});

describe('signing out clears the cached snapshot', () => {
  const SignOutButton: React.FC = () => {
    const { signOut } = useAuth();
    return <button onClick={() => signOut()}>sign out</button>;
  };

  it('removes any repvision storage snapshot from the device', async () => {
    localStorage.setItem('repvision:storage:v1:u1', JSON.stringify({ history: [], templates: [] }));
    await mountAndSettle(<AuthProvider><SignOutButton /></AuthProvider>);

    await act(async () => { screen.getByRole('button').click(); });

    expect(localStorage.getItem('repvision:storage:v1:u1')).toBeNull();
  });
});
