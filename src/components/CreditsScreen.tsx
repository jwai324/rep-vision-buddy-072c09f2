import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Sparkles, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { creditsFromMicros, MICROS_PER_CREDIT } from '@/utils/credits';
import type { UserProfile, SubscriptionTier } from '@/hooks/useStorage';

interface CreditsScreenProps {
  profile: UserProfile;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onBack: () => void;
}

const TIERS: { value: SubscriptionTier; label: string; blurb: string }[] = [
  { value: 'free', label: 'Free', blurb: '500 credits each month. Top up or upgrade for more.' },
  { value: 'premium', label: 'Premium', blurb: '7,000 credits each month. Resets monthly; top up if you run out early.' },
];

interface LedgerRow {
  id: string;
  delta_micros: number;
  reason: string;
  created_at: string;
  balance_after_micros: number;
}


const REASON_LABELS: Record<string, string> = {
  ai_coach: 'AI chat',
  generate_program: 'Program generation',
  iap_purchase: 'Top-up',
  iap_subscription: 'Subscription',
  admin_grant: 'Grant',
  refund_adjustment: 'Refund',
};

const signedCredits = (micros: number): string => {
  const c = Math.round(micros / MICROS_PER_CREDIT);
  return c > 0 ? `+${c}` : `${c}`;
};

export const CreditsScreen: React.FC<CreditsScreenProps> = ({ profile, onUpdateProfile, onBack }) => {
  const { user } = useAuth();
  const { creditsBalance, refreshBalance } = useChatContext();
  const { toast } = useToast();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  const tier = profile.subscriptionTier;
  const isPremium = tier === 'premium';

  const selectTier = (next: SubscriptionTier) => {
    if (next === tier) return;
    onUpdateProfile({ subscriptionTier: next });
    toast({
      title: next === 'premium' ? 'Premium enabled' : 'Switched to Free',
      description: next === 'premium'
        ? 'Unlimited AI coach access (test mode).'
        : 'You now use the monthly free credit allowance.',
    });
  };

  const loadLedger = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('token_ledger')
      .select('id, delta_micros, reason, created_at, balance_after_micros')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setLedger((data as LedgerRow[]) ?? []);
  }, [user]);

  useEffect(() => { loadLedger(); }, [loadLedger]);

  // The allowance period is the UTC calendar month (free_period is stamped
  // from now() AT TIME ZONE 'utc'), so the reset day is named in UTC as well.
  // Formatting the boundary in local time put it on the 30th in the evening
  // west of Greenwich and on the 2nd in the morning east of it.
  const nextReset = (() => {
    const now = new Date();
    const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return boundary.toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' });
  })();

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">Subscription</h1>
      </div>

      {/* Plan */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Plan</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {TIERS.map(t => {
            const active = t.value === tier;
            return (
              <button
                key={t.value}
                onClick={() => selectTier(t.value)}
                aria-pressed={active}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-foreground">{t.label}</span>
                  {active && <Check className="w-4 h-4 text-primary" />}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{t.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>

      {isPremium && (
        <p className="text-[11px] text-muted-foreground -mt-2 px-1">
          You're on Premium — 7,000 credits included each month (the balance below). It resets monthly; top up if you run out early.
        </p>
      )}

      {/* Balance */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-5 flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-3xl font-extrabold text-foreground">{creditsBalance.credits}</span>
            <span className="text-sm text-muted-foreground">credits</span>
          </div>
          <p className="text-xs text-muted-foreground">
            ≈ {creditsBalance.estMessagesLeft} messages left
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-border">
          <div className="px-4 py-3 border-r border-border">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Monthly allowance</p>
            <p className="text-sm font-semibold text-foreground">
              {creditsFromMicros(creditsBalance.freeRemainingMicros)} credits
            </p>
            <p className="text-[11px] text-muted-foreground">Resets {nextReset}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Purchased</p>
            <p className="text-sm font-semibold text-foreground">
              {creditsFromMicros(Math.max(0, creditsBalance.paidMicros))} credits
            </p>
          </div>
        </div>
      </div>

      {/* Get more */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Get more credits</p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          {/* The in-app packs used to call the grant-tokens stub with an admin
              secret read from VITE_GRANT_TOKENS_SECRET. Vite inlines every
              VITE_* value into the shipped bundle, so the only build in which
              the buttons worked was a build that published the secret — and
              that endpoint accepts an arbitrary target user and an uncapped
              amount. Real purchases must be granted server-side from a verified
              receipt; there is no safe way to do it from the browser. */}
          <p className="text-sm text-muted-foreground text-center py-2">
            In-app purchases coming soon.
          </p>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Recent activity</p>
        </div>
        {ledger.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {ledger.map(row => (
              <li key={row.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm text-foreground">
                    {REASON_LABELS[row.reason] ?? row.reason}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold ${
                    row.delta_micros >= 0 ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {signedCredits(row.delta_micros)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
