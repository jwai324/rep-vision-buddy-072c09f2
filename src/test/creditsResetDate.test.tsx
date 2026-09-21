import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CreditsScreen } from '@/components/CreditsScreen';
import type { UserProfile } from '@/hooks/useStorage';

// West of Greenwich, where the evening is already the next UTC day.
process.env.TZ = 'America/Los_Angeles';

vi.mock('@/integrations/supabase/client', () => {
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    limit: async () => ({ data: [], error: null }),
  };
  return { supabase: { from: () => chain } };
});
// One user object for the whole file: the ledger effect is keyed on it, so a
// fresh object per render (which the real AuthContext never hands out) would
// refetch on every render and never let act settle.
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
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const profile: UserProfile = {
  displayName: null, goal: null, hybridGoals: [], coachNotes: null, experienceLevel: null,
  equipment: [], injuries: [], age: null, sex: null, heightCm: null, subscriptionTier: 'free',
};

describe('CreditsScreen — allowance reset date', () => {
  // setSystemTime without fake timers mocks Date alone, leaving act's timers real.
  afterEach(() => { vi.useRealTimers(); });

  it('names the first of the next UTC month whatever the local clock says', async () => {
    // 20 Sep, 8 pm in Los Angeles is already 21 Sep in UTC.
    vi.setSystemTime(new Date('2026-09-21T03:00:00Z'));
    render(<CreditsScreen profile={profile} onUpdateProfile={vi.fn()} onBack={vi.fn()} />);
    await act(async () => {});

    expect(screen.getByText('Resets October 1')).toBeInTheDocument();
  });

  it('does not slip to the 2nd east of Greenwich', async () => {
    process.env.TZ = 'Australia/Sydney';
    // 21 Sep, 5 am in Sydney is still 20 Sep in UTC.
    vi.setSystemTime(new Date('2026-09-20T19:00:00Z'));
    try {
      render(<CreditsScreen profile={profile} onUpdateProfile={vi.fn()} onBack={vi.fn()} />);
      await act(async () => {});
      expect(screen.getByText('Resets October 1')).toBeInTheDocument();
    } finally {
      process.env.TZ = 'America/Los_Angeles';
    }
  });
});
