import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { clearStorageCache } from '@/utils/storageCache';
import { clearAllPendingTemplates } from '@/utils/pendingTemplateWrites';
import { clearLocalDrafts } from '@/utils/localDrafts';
import { releaseRestSchedule } from '@/utils/restTimerScheduler';
import { toast } from 'sonner';
import type { User, Session } from '@supabase/supabase-js';

/**
 * Everything on this device that belongs to the account rather than to the
 * device: the cached snapshot, the pending-template queue, the in-progress
 * workout and the builder/chat drafts, and a rest still counting down. None of
 * it is namespaced by user, so the next account on a shared phone would
 * otherwise resume the previous one's half-finished workout and could save it
 * into its own history.
 *
 * Run from the SIGNED_OUT event rather than from the Sign Out button, because
 * the button is only one of the ways a session ends: auth-js also removes the
 * session itself when a token refresh is refused — which is exactly what
 * signing out on any other of the user's devices causes, since the default
 * sign-out scope revokes every refresh token — and it emits SIGNED_OUT in
 * every open tab. The button path could not see any of those.
 */
function forgetAccountOnThisDevice(): void {
  clearStorageCache();
  clearAllPendingTemplates();
  clearLocalDrafts();
  releaseRestSchedule();
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Supabase deserializes a brand-new user object on every auth event, and
   * token refreshes fire one each time the tab regains focus. Handing that
   * new identity to consumers re-ran every `[user]`-keyed effect and callback
   * in the app — most visibly `useStorage`, which threw the whole UI back to
   * a loading spinner and refetched everything.
   *
   * `updated_at` moves whenever the user record itself actually changes, so
   * holding the previous object while both it and the id match keeps genuine
   * profile updates flowing while a plain token refresh becomes a no-op.
   */
  const applyUser = useCallback((next: User | null) => {
    setUser(prev =>
      prev && next && prev.id === next.id && prev.updated_at === next.updated_at
        ? prev
        : next,
    );
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') forgetAccountOnThisDevice();
      setSession(session);
      applyUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      applyUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [applyUser]);

  const signOut = useCallback(async () => {
    // Nothing is cleared until the sign-out has actually happened. With no
    // signal (or Auth returning 5xx) auth-js resolves with an error and keeps
    // the session, so the user is still signed in — and would have lost the
    // workout they were in the middle of, plus every draft, for nothing.
    const { error } = (await supabase.auth.signOut()) ?? { error: null };
    if (error) {
      toast.error('Could not sign out. Check your connection and try again.');
      return;
    }
    // SIGNED_OUT has normally fired by now and done this; a backstop for a
    // client that resolved without emitting it.
    forgetAccountOnThisDevice();
  }, []);

  // A fresh object literal here would re-render every consumer on any
  // provider render, undoing the identity work above.
  const value = useMemo(
    () => ({ user, session, loading, signOut }),
    [user, session, loading, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
