import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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

/**
 * "This device cannot reach Auth" told apart from "this login is over".
 *
 * Both arrive as `getSession()` resolving with no session, so the missing
 * session cannot be the test. auth-js raises `AuthRetryableFetchError` — and
 * only that — when the refresh never got an answer it could use (a fetch that
 * never completed, or a 502/503/504 gateway), and it deliberately leaves the
 * stored session in place to try again. Every actual refusal — an expired or
 * revoked refresh token, a deleted user, a session the server no longer knows
 * — comes back as `AuthApiError` or `AuthSessionMissingError`, and auth-js has
 * already removed the stored session and emitted SIGNED_OUT by then.
 */
function isUnreachable(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null &&
    (error as { name?: unknown }).name === 'AuthRetryableFetchError'
  );
}

/**
 * The session auth-js has persisted, read straight out of its storage.
 *
 * Only consulted once a check has failed for a connection reason, where its
 * presence is the second half of the test: auth-js keeps the session for a
 * failure it can retry and removes it for a refusal, so a session still on
 * disk means this login was never rejected. The key is auth-js's own
 * `sb-<project ref>-auth-token` — matched by shape rather than rebuilt from
 * the URL, so pointing the client at another project cannot silently break it
 * — and the value is plain JSON.
 */
function readStoredSession(): Session | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (!('access_token' in parsed) || !('refresh_token' in parsed)) continue;
      const stored = parsed as Session;
      if (stored.user?.id) return stored;
    }
  } catch {
    // Blocked site data, a memory-only storage adapter, or a value that will
    // not parse: there is nothing to fall back on, so the caller signs out.
  }
  return null;
}

const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 30_000;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Signed in on a session that could not be refreshed; a retry is pending. */
  reconnecting: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  reconnecting: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

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

  /** A settled answer: this is the session, or there is none. */
  const applySession = useCallback((next: Session | null) => {
    setReconnecting(false);
    setSession(next);
    applyUser(next?.user ?? null);
    setLoading(false);
  }, [applyUser]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    // True between a connection failure and the answer that resolves it.
    let unreachable = false;

    // A settled answer ends whatever retry was pending.
    const settle = (next: Session | null) => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      attempt = 0;
      unreachable = false;
      applySession(next);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        forgetAccountOnThisDevice();
        settle(null);
        return;
      }
      // INITIAL_SESSION carries no session when the refresh could not reach
      // Auth, which on its own is indistinguishable from being signed out —
      // and acting on it is what put an offline user on a sign-in screen they
      // had no way to use. `check` below asks the same question and gets the
      // error that tells the two apart, so this one event is left to it.
      if (!next && event === 'INITIAL_SESSION') return;
      settle(next);
    });

    const check = async () => {
      let result: Awaited<ReturnType<typeof supabase.auth.getSession>> | null = null;
      let thrown: unknown = null;
      try {
        result = await supabase.auth.getSession();
      } catch (e) {
        // A refusal is always delivered as a resolved value, so a rejection
        // here is the transport (or auth-js's lock) rather than an answer.
        thrown = e;
      }
      if (cancelled) return;

      const next = result?.data?.session ?? null;
      if (next) {
        settle(next);
        return;
      }

      const failure = thrown ?? result?.error ?? null;
      const stored = failure ? readStoredSession() : null;
      if (stored && (thrown !== null || isUnreachable(failure))) {
        if (!unreachable) {
          // Stay in the app on the locally cached snapshot. Signing out here
          // would strand the user on a sign-in screen that needs the very
          // connection that just failed, and lose their place on the way back.
          unreachable = true;
          setSession(stored);
          applyUser(stored.user);
          setReconnecting(true);
          setLoading(false);
        }
        attempt += 1;
        retryTimer = setTimeout(
          () => void check(),
          Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1)),
        );
        return;
      }

      settle(null);
    };

    const onOnline = () => {
      if (!unreachable) return;
      clearTimeout(retryTimer);
      attempt = 0;
      void check();
    };
    window.addEventListener('online', onOnline);

    void check();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      subscription.unsubscribe();
    };
  }, [applySession, applyUser]);

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
    () => ({ user, session, loading, reconnecting, signOut }),
    [user, session, loading, reconnecting, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* Deliberately quiet, and deliberately not a screen: nothing about the
          app is blocked, the cached data on screen is the user's own, and the
          state clears itself the moment a refresh gets through. Bottom-left
          mirrors the coach's bubble; the bug handle owns the top centre. */}
      {reconnecting && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-4 z-40 pointer-events-none flex items-center gap-2 rounded-full border border-border bg-secondary/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur"
        >
          <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          Reconnecting…
        </div>
      )}
    </AuthContext.Provider>
  );
};
