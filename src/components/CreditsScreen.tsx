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
  { value: 'free', label: 'Free', blurb: '500 AI credits each month. Top up for more, or upgrade any time.' },
  { value: 'premium', label: 'Premium', blurb: 'Unlimited AI coach access. (Test mode — no charge while the app is in testing.)' },
];

interface LedgerRow {
  id: string;
  delta_micros: number;
  reason: string;
  created_at: string;
  balance_after_micros: number;
}

const PACKS: { id: string; label: string; desc: string }[] = [
  { id: 'topup_small', label: 'Small top-up', desc: '+5,000 credits' },
  { id: 'topup_large', label: 'Large top-up', desc: '+20,000 credits' },
  { id: 'sub_month', label: 'Monthly allowance (test)', desc: '+45,000 credits' },
];

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
  const [granting, setGranting] = useState<string | null>(null);

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

  const stubSecret = import.meta.env.VITE_GRANT_TOKENS_SECRET as string | undefined;

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

  const buyPack = async (pack: string) => {
    if (!stubSecret) return;
    setGranting(pack);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${session?.access_token ?? anonKey}`,
          'x-admin-secret': stubSecret,
        },
        body: JSON.stringify({ pack }),
      });
      if (!resp.ok) throw new Error(`Grant failed (${resp.status})`);
      await refreshBalance();
      await loadLedger();
      toast({ title: 'Credits added', description: 'Your balance has been updated.' });
    } catch (e) {
      toast({
        title: 'Purchase failed',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setGranting(null);
    }
  };

  const nextReset = (() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
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
          You're on Premium — the AI coach is unlimited and the credit balance below isn't enforced. Switch to Free to test the metered experience.
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
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Free this month</p>
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
          {stubSecret ? (
            PACKS.map(pack => (
              <Button
                key={pack.id}
                variant="outline"
                className="w-full justify-between"
                disabled={granting !== null}
                onClick={() => buyPack(pack.id)}
              >
                <span className="font-semibold">{pack.label}</span>
                <span className="text-xs text-muted-foreground">
                  {granting === pack.id ? 'Adding…' : pack.desc}
                </span>
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              In-app purchases coming soon.
            </p>
          )}
          {stubSecret && (
            <p className="text-[11px] text-muted-foreground">
              Test mode — these packs grant credits directly without a real purchase.
            </p>
          )}
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
