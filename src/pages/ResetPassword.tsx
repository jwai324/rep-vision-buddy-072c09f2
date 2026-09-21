import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Dumbbell, MailWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type ResetLinkFailure = 'expired' | 'unknown';

const FAILURE_COPY: Record<ResetLinkFailure, { title: string; body: string }> = {
  expired: {
    title: 'That link has expired',
    body: 'Password reset links can only be used once, and they stop working after a short while. Send yourself a fresh one and open it straight away.',
  },
  unknown: {
    title: 'That link is no longer valid',
    body: 'We could not use the link from your email. Send yourself a fresh one and open it on this device.',
  },
};

/**
 * Supabase reports a refused recovery link in the URL rather than through an
 * auth event: in the hash on the implicit flow, in the query string on PKCE.
 * Only the codes are read — `error_description` is the provider's own prose and
 * can name the address the link was issued for, so it is never shown or logged.
 */
function readResetLinkFailure(url: { hash?: string; search?: string }): ResetLinkFailure | null {
  for (const raw of [url.hash, url.search]) {
    const params = new URLSearchParams((raw ?? '').replace(/^[#?]/, ''));
    const code = params.get('error_code');
    if (!params.get('error') && !code) continue;
    return code === 'otp_expired' || code === 'flow_state_expired' ? 'expired' : 'unknown';
  }
  return null;
}

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [failure] = useState<ResetLinkFailure | null>(() =>
    readResetLinkFailure({ hash: window.location.hash, search: window.location.search }),
  );
  const [openingRequestForm, setOpeningRequestForm] = useState(false);
  const [requestEmail, setRequestEmail] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    // Also check hash for type=recovery
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Asking for a new link happens HERE rather than on `/auth`, and that is
   * deliberate. `/auth` is the only other screen that issues reset links, but
   * `AuthRoute` sends a signed-in visitor away from it, and Supabase keeps the
   * session the device already had when a recovery link is refused — so a
   * signed-in user tapping this would land on the dashboard with no form. The
   * obvious workaround, signing out first, is worse than the bug: auth-js
   * emits SIGNED_OUT, and `AuthContext` answers that by clearing the storage
   * snapshot, the builder and chat drafts, and the in-progress workout cache.
   * Opening a stale reset link would have thrown away a workout in progress.
   */
  const sendNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = requestEmail.trim();
    if (!address) return;
    setOpeningRequestForm(true);
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setOpeningRequestForm(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Always the same answer, sent or not: whether an address has an account
    // is not something this page should confirm to whoever is holding it.
    setRequestSent(true);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated successfully!');
      navigate('/');
    }
    setLoading(false);
  };

  if (!isRecovery && failure) {
    const copy = FAILURE_COPY[failure];
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <Card className="w-full max-w-sm border-border">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
              <MailWarning className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle className="text-xl">{copy.title}</CardTitle>
            <CardDescription>{copy.body}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {requestSent ? (
              <p className="text-sm text-muted-foreground text-center">
                If that address has an account, a new link is on its way. It is
                good for one use and expires shortly, so open it soon.
              </p>
            ) : (
              <form onSubmit={sendNewLink} className="space-y-2">
                <Label htmlFor="reset-request-email" className="text-xs text-muted-foreground">
                  Your email
                </Label>
                <Input
                  id="reset-request-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={requestEmail}
                  onChange={e => setRequestEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <Button type="submit" variant="neon" className="w-full" disabled={openingRequestForm}>
                  {openingRequestForm ? 'Sending…' : 'Send me a new link'}
                </Button>
              </form>
            )}
            <Button variant="ghost" className="w-full" onClick={() => navigate('/auth')}>
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <Card className="w-full max-w-sm border-border">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground text-sm">
              This page is for resetting your password. Please use the link from your email.
            </p>
            <Button variant="outline" onClick={() => navigate('/auth')}>
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <Card className="w-full max-w-sm border-border">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Dumbbell className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Reset Password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <Button type="submit" variant="neon" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
