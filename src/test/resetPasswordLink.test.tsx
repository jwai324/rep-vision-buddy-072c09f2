import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

const ResetPassword = (await import('@/pages/ResetPassword')).default;
const Auth = (await import('@/pages/Auth')).default;

/** The reset page reads the real URL, so the test sets one rather than a router. */
function openWith(urlSuffix: string) {
  window.history.replaceState(null, '', `/reset-password${urlSuffix}`);
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth" element={<Auth />} />
      </Routes>
    </MemoryRouter>,
  );
}

const GENERIC = /This page is for resetting your password/;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('a reset link the provider refused', () => {
  it('says the link expired instead of the generic card', () => {
    openWith('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');

    expect(screen.getByText('That link has expired')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send me a new link' })).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
  });

  it('never shows the provider’s own error text, which can name the address', () => {
    openWith('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');

    expect(screen.queryByText(/Email link is invalid/i)).toBeNull();
  });

  it('reads the same failure out of the query string, as the PKCE flow sends it', () => {
    openWith('?error=access_denied&error_code=otp_expired');

    expect(screen.getByText('That link has expired')).toBeTruthy();
  });

  it('still shows a usable message for an error code it cannot name', () => {
    openWith('#error=server_error&error_code=unexpected_failure');

    expect(screen.getByText('That link is no longer valid')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send me a new link' })).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
  });

  it('does the same when the provider sends no code at all', () => {
    openWith('#error=access_denied');

    expect(screen.getByText('That link is no longer valid')).toBeTruthy();
  });

  it('offers a way to get a new link on the card, not a trip to sign-in', async () => {
    openWith('#error=access_denied&error_code=otp_expired');

    // The form is on the card itself. Reaching it by navigating would fail for
    // a signed-in user, and reaching it by signing them out would clear their
    // in-progress workout — see src/test/resetPasswordSignedIn.test.tsx.
    expect(screen.getByLabelText(/your email/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'lifter@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send me a new link/i }));
    });

    await waitFor(() => expect(screen.getByText(/if that address has an account/i)).toBeTruthy());
  });
});

describe('a reset link that worked', () => {
  it('still reaches the password form', () => {
    openWith('#access_token=abc&refresh_token=def&type=recovery');

    expect(screen.getByLabelText('New Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update Password' })).toBeTruthy();
  });
});

describe('the page opened without a link at all', () => {
  it('keeps the generic card', () => {
    openWith('');

    expect(screen.getByText(GENERIC)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send me a new link' })).toBeNull();
  });
});
