import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CreditsScreen } from '@/components/CreditsScreen';
import { FREE_MONTHLY_MICROS, PREMIUM_MONTHLY_MICROS, creditsFromMicros } from '@/utils/credits';
import type { UserProfile } from '@/hooks/useStorage';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => {
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    limit: async () => ({ data: [], error: null }),
  };
  return { supabase: { from: () => chain } };
});
// One user object for the whole file: the ledger effect is keyed on it, so a
// fresh object per render would refetch forever and never let act settle.
vi.mock('@/contexts/AuthContext', () => {
  const user = { id: 'u1' };
  return { useAuth: () => ({ user }) };
});
vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    creditsBalance: {
      availableMicros: 0, paidMicros: 0, freeRemainingMicros: 0,
      credits: 0, estMessagesLeft: 0, lowBalance: false, exhausted: false,
    },
    refreshBalance: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const profile = (tier: UserProfile['subscriptionTier']): UserProfile => ({
  displayName: null, goal: null, hybridGoals: [], coachNotes: null, experienceLevel: null,
  equipment: [], injuries: [], age: null, sex: null, heightCm: null, subscriptionTier: tier,
});

const renderScreen = async (tier: UserProfile['subscriptionTier']) => {
  render(<CreditsScreen profile={profile(tier)} onUpdateProfile={vi.fn()} onBack={vi.fn()} />);
  await act(async () => {});
};

describe('CreditsScreen — plan-change toast', () => {
  beforeEach(() => { mocks.toast.mockClear(); });

  it('is the allowance the server meters, not an unlimited-access claim', async () => {
    await renderScreen('free');
    fireEvent.click(screen.getByText('Premium'));

    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const { title, description } = mocks.toast.mock.calls[0][0] as {
      title: string; description: string;
    };
    expect(title).toBe('Premium enabled');
    expect(description).toContain(
      `${creditsFromMicros(PREMIUM_MONTHLY_MICROS).toLocaleString()} credits each month`,
    );
    expect(description).not.toMatch(/unlimited/i);
  });

  // The owner-confirmed figure, pinned against a silent edit of either mirror.
  it('quotes 7,000 credits, which is what the constants say', () => {
    expect(PREMIUM_MONTHLY_MICROS).toBe(7_000_000);
    expect(creditsFromMicros(PREMIUM_MONTHLY_MICROS)).toBe(7000);
  });

  it('names the free allowance when switching down, and matches the plan card', async () => {
    await renderScreen('premium');
    fireEvent.click(screen.getByText('Free'));

    const { title, description } = mocks.toast.mock.calls[0][0] as {
      title: string; description: string;
    };
    expect(title).toBe('Switched to Free');
    expect(description).toContain(
      `${creditsFromMicros(FREE_MONTHLY_MICROS).toLocaleString()} credits each month`,
    );
    // The card for the plan being switched to says the same thing.
    expect(screen.getByText(description)).toBeInTheDocument();
  });
});
