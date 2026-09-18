import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { USER_DRAFT_KEYS, ACTIVE_SESSION_CACHE_KEY, clearLocalDrafts } from '@/utils/localDrafts';

type AuthCallback = (event: string, session: null) => void;
let emit: AuthCallback = () => undefined;
const signOutMock = vi.fn<() => Promise<{ error: Error | null }>>();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: () => signOutMock(),
    },
  },
}));

const { AuthProvider, useAuth } = await import('@/contexts/AuthContext');

const SignOutButton: React.FC = () => {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>out</button>;
};

const seed = () => {
  for (const key of USER_DRAFT_KEYS) localStorage.setItem(key, 'x');
  // Not a draft: survives sign-out, because it is the device's, not the user's.
  localStorage.setItem('restTimerSound', 'on');
};

beforeEach(() => {
  localStorage.clear();
  // What auth-js does on a successful sign-out: emits SIGNED_OUT in every
  // tab, then resolves with no error.
  signOutMock.mockImplementation(async () => {
    emit('SIGNED_OUT', null);
    return { error: null };
  });
});

describe('user drafts on sign-out', () => {
  it('lists the in-progress workout cache among the keys it clears', () => {
    expect(USER_DRAFT_KEYS).toContain(ACTIVE_SESSION_CACHE_KEY);
  });

  it('clearLocalDrafts removes every listed key and nothing else', () => {
    seed();
    clearLocalDrafts();
    for (const key of USER_DRAFT_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('restTimerSound')).toBe('on');
  });

  it('signing out clears them, so the next account cannot resume this one\'s workout', async () => {
    seed();
    render(<AuthProvider><SignOutButton /></AuthProvider>);

    await act(async () => { screen.getByText('out').click(); });

    expect(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY)).toBeNull();
    expect(localStorage.getItem('template_builder_draft')).toBeNull();
    expect(localStorage.getItem('ai-chat-input-draft')).toBeNull();
    expect(localStorage.getItem('restTimerSound')).toBe('on');
  });

  it('a session auth-js ends on its own clears them too: a refresh refused after a sign-out elsewhere', async () => {
    // The Sign Out button never runs here. auth-js drops the session and emits
    // SIGNED_OUT when a token refresh is refused, which is what signing out on
    // another device does to this one (the default scope is global).
    seed();
    render(<AuthProvider><SignOutButton /></AuthProvider>);

    await act(async () => { emit('SIGNED_OUT', null); });

    for (const key of USER_DRAFT_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('restTimerSound')).toBe('on');
  });

  it('a sign-out that fails leaves everything in place, because the user is still signed in', async () => {
    // Offline or a 5xx from Auth: auth-js resolves with an error and keeps
    // the session. Wiping the workout first would have lost it for nothing.
    signOutMock.mockImplementation(async () => ({ error: new Error('Failed to fetch') }));
    seed();
    render(<AuthProvider><SignOutButton /></AuthProvider>);

    await act(async () => { screen.getByText('out').click(); });

    for (const key of USER_DRAFT_KEYS) expect(localStorage.getItem(key)).toBe('x');
  });
});
