import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { clearStorageCache } from '@/utils/storageCache';
import type { User, Session } from '@supabase/supabase-js';

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
    // Drop the cached snapshot first so the next account on this device can't
    // be shown the previous one's data while its own load is in flight.
    clearStorageCache();
    await supabase.auth.signOut();
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
