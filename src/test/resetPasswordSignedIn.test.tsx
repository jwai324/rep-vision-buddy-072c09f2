import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';

/**
 * Supabase keeps the session a device already had when a recovery link is
 * refused, so the failure card is reached by users who are still signed in.
 * `/auth` is the app's only other issuer of reset links and `AuthRoute` turns a
 * signed-in visitor away from it, so the request form lives on this page and
 * the page must never reach it by signing the user out: `AuthContext` answers
 * SIGNED_OUT by clearing the storage snapshot, the drafts and the in-progress
 * workout cache. These render the real `App` — routes, wrappers and all — so
 * that redirect is in play rather than mocked away.
 */

type AuthCallback = (event: string, session: Session | null) => void;
let emit: AuthCallback = () => {};
let currentSession: Session | null = null;

const signOut = vi.fn(async () => {
  currentSession = null;
  emit('SIGNED_OUT', null);
  return { error: null };
});
const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve({ data: { session: currentSession }, error: null }),
      signOut,
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail,
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

const App = (await import('@/App')).default;

const signedIn = {
  access_token: 'jwt',
  refresh_token: 'refresh',
  expires_at: 9_999_999_999,
  token_type: 'bearer',
  user: { id: 'signed-in-user', updated_at: '2026-09-01T00:00:00Z' } as User,
} as unknown as Session;

const EXPIRED = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

const openExpiredLink = async () => {
  window.history.replaceState(null, '', `/reset-password${EXPIRED}`);
  render(<App />);
  await act(async () => { await Promise.resolve(); });
};

const requestNewLink = async (address: string) => {
  fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /send me a new link/i }));
  });
};

beforeEach(() => {
  localStorage.clear();
  currentSession = null;
  signOut.mockClear();
  resetPasswordForEmail.mockClear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('asking for a new link while still signed in on this device', () => {
  it('offers the form on the card itself rather than bouncing to the dashboard', async () => {
    currentSession = signedIn;
    await openExpiredLink();

    expect(screen.getByText('That link has expired')).toBeTruthy();
    expect(screen.getByLabelText(/your email/i)).toBeTruthy();
    // Still on the reset page: no navigation to a route that would turn a
    // signed-in visitor away.
    expect(window.location.pathname).toBe('/reset-password');
  });

  it('issues the link without ending the session, which would wipe a workout in progress', async () => {
    currentSession = signedIn;
    await openExpiredLink();

    await requestNewLink('lifter@example.com');

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      'lifter@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') }),
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it('confirms without saying whether the address has an account', async () => {
    currentSession = signedIn;
    await openExpiredLink();

    await requestNewLink('lifter@example.com');

    await waitFor(() => expect(screen.getByText(/if that address has an account/i)).toBeTruthy());
  });
});

describe('asking for a new link while signed out', () => {
  it('uses the same form on the same card', async () => {
    await openExpiredLink();

    await requestNewLink('lifter@example.com');

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('sends nothing until an address is given', async () => {
    await openExpiredLink();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send me a new link/i }));
    });

    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
