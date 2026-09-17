import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { USER_DRAFT_KEYS, ACTIVE_SESSION_CACHE_KEY, clearLocalDrafts } from '@/utils/localDrafts';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: vi.fn().mockResolvedValue(undefined),
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

beforeEach(() => localStorage.clear());

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
});
