import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, cleanup } from '@testing-library/react';
import { CreditsScreen, creditsBreakdown } from '@/components/CreditsScreen';
import { deriveBalance, type CreditsBalance } from '@/utils/credits';
import type { UserProfile } from '@/hooks/useStorage';

// Audit 2.20. A turn that cost slightly more than the balance left drove
// paid_balance_micros negative; the headline balance (free + paid) absorbed
// the debt while "Purchased" printed it through Math.max(0, ...) as 0, so the
// three figures on the balance card stopped adding up and the next month's
// allowance was netted against a number the user could not see. The server now
// floors the paid balance at zero and forgives the overshoot; this file pins
// the screen's half of that — the two rows always sum to the headline above
// them, including for a row still carrying a pre-migration negative.

vi.mock('@/integrations/supabase/client', () => {
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    limit: async () => ({ data: [], error: null }),
  };
  return { supabase: { from: () => chain } };
});

// One user object for the whole file: the ledger effect is keyed on it, so a
// fresh object per render would refetch on every render and never settle.
vi.mock('@/contexts/AuthContext', () => {
  const user = { id: 'u1' };
  return { useAuth: () => ({ user }) };
});

let balance: CreditsBalance = deriveBalance(null, 'free');
vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    creditsBalance: balance,
    creditsBalanceKnown: true,
    refreshBalance: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const profile: UserProfile = {
  displayName: null, goal: null, hybridGoals: [], coachNotes: null, experienceLevel: null,
  equipment: [], injuries: [], age: null, sex: null, heightCm: null, subscriptionTier: 'free',
};

// The row shape refreshBalance() selects, run through the same derivation the
// app uses, so the test exercises real balances rather than hand-built ones.
const balanceOf = (paidMicros: number, freeUsedMicros: number): CreditsBalance =>
  deriveBalance(
    {
      paid_balance_micros: paidMicros,
      free_used_micros: freeUsedMicros,
      free_period: new Date().toISOString().slice(0, 7),
    },
    'free',
  );

const renderScreen = async (b: CreditsBalance) => {
  balance = b;
  render(<CreditsScreen profile={profile} onUpdateProfile={vi.fn()} onBack={vi.fn()} />);
  await act(async () => {});
};

// The big number at the top of the balance card, read off the "credits" label
// beside it.
const headline = (): number =>
  Number(screen.getByText('credits').previousElementSibling!.textContent);

// The figure in the cell under `label`; the cell's own text ends in "credits"
// too, so the paragraph is addressed explicitly.
const figure = (label: string): number => {
  const cell = screen.getByText(label).parentElement!;
  const text = within(cell).getByText(/ credits$/, { selector: 'p' }).textContent!;
  return Number(text.replace(' credits', ''));
};

describe('CreditsScreen — the balance card adds up', () => {
  beforeEach(() => { cleanup(); });

  it('reconciles a plain balance', async () => {
    // 500,000 allowance, half spent, plus 100,000 purchased.
    await renderScreen(balanceOf(100_000, 250_000));

    expect(figure('Monthly allowance')).toBe(250);
    expect(figure('Purchased')).toBe(100);
    expect(headline()).toBe(350);
    expect(figure('Monthly allowance') + figure('Purchased')).toBe(headline());
  });

  it('reconciles when neither part is a whole number of credits', async () => {
    // 400 micros of allowance spent and 1,600 micros purchased: the headline
    // keeps the sub-credit remainder (501), so flooring the two rows
    // independently would print 499 + 1 = 500 under it.
    await renderScreen(balanceOf(1_600, 400));

    expect(headline()).toBe(501);
    expect(figure('Monthly allowance') + figure('Purchased')).toBe(501);
    // Purchased is never rounded up past what is actually held.
    expect(figure('Purchased')).toBe(1);
  });

  it('never shows more purchased credits than the balance holds', async () => {
    await renderScreen(balanceOf(999, 0));

    expect(figure('Purchased')).toBe(0);
    expect(figure('Monthly allowance')).toBe(headline());
  });

  it('still adds up for a row left negative from before the forgiveness', async () => {
    // The month after the overspend, which is where the old screen was at its
    // most misleading: the allowance has reset to its full 500 credits and the
    // headline is quietly 20 short of it, because the hidden -20,000 is netted
    // out of it. Until the sweep in
    // PENDING_forgive_overspend_floor_paid_balance.sql lands, the debt shows
    // up in the allowance row rather than nowhere at all.
    await renderScreen(balanceOf(-20_000, 0));

    expect(headline()).toBe(480);
    expect(figure('Purchased')).toBe(0);
    expect(figure('Monthly allowance')).toBe(480);
    expect(figure('Monthly allowance') + figure('Purchased')).toBe(headline());
  });
});

describe('creditsBreakdown', () => {
  const cases: [number, number][] = [
    [0, 0], [1, 0], [999, 999], [1_600, 400], [100_000, 250_000],
    [7_000_000, 500_000], [-20_000, 500_000], [-615_274, 123_456],
  ];

  it('always splits the headline exactly', () => {
    for (const [paid, freeUsed] of cases) {
      const b = balanceOf(paid, freeUsed);
      const { allowance, purchased } = creditsBreakdown(b);
      expect(allowance + purchased).toBe(b.credits);
      expect(allowance).toBeGreaterThanOrEqual(0);
      expect(purchased).toBeGreaterThanOrEqual(0);
      // Purchased is never more than the paid balance really covers.
      expect(purchased).toBeLessThanOrEqual(Math.max(0, paid) / 1000);
    }
  });
});
