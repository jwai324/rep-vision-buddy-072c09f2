import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getSessionCache } from '@/utils/sessionCache';
import { isSessionActive } from '@/hooks/useSessionController';
import { clearPendingTemplatesFor } from '@/utils/pendingTemplateWrites';
import { COACH_STORAGE_PREFIX, USER_DRAFT_KEYS, ownerDraftKey } from '@/utils/localDrafts';
import { forgetClientThreads } from '@/utils/chatThreads';
import type { SubscriptionTier } from '@/hooks/useStorage';

/**
 * Whose data the app is showing.
 *
 * A coach "acts as" a client: the whole app re-renders against the client's
 * rows (`ownerId`), while the session — and so billing, credits, share links
 * and bug reports — stays the coach's own (`authUserId`). Every data hook keys
 * on `ownerId`; nothing that belongs to the person holding the phone may.
 * `Index` is remounted on `ownerId`, so no state, ref or in-flight write from
 * one identity can land in the next.
 *
 * The database is what actually grants the access (the coach policies in
 * `supabase/migrations/*_coach_mode.sql`); this context only chooses which of
 * the rows the signed-in user can already reach are on screen.
 */

export interface CoachClient {
  linkId: string;
  clientId: string;
  displayName: string | null;
  linkedAt: string;
}

export interface ActingAs {
  clientId: string;
  displayName: string | null;
}

export interface CoachContextValue {
  authUserId: string | null;
  ownerId: string | null;
  actingAs: ActingAs | null;
  clients: CoachClient[];
  clientsLoaded: boolean;
  /** The signed-in user's own plan, which is what their AI usage is metered on. */
  ownTier: SubscriptionTier | null;
  refreshClients: () => Promise<void>;
  /** False when refused (a workout is in progress on this device). */
  actAs: (client: ActingAs) => boolean;
  stopActing: () => boolean;
  /** The data layer found the client's rows unreachable: the link is gone. */
  accessLost: (clientId: string) => void;
}

const CoachContext = createContext<CoachContextValue | null>(null);

const actingKey = (authUserId: string) => `${COACH_STORAGE_PREFIX}acting:${authUserId}`;

export const SWITCH_BLOCKED_MESSAGE =
  'Finish or discard the workout in progress before switching accounts.';

function readPersistedActing(authUserId: string): ActingAs | null {
  try {
    const raw = localStorage.getItem(actingKey(authUserId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActingAs> | null;
    if (!parsed || typeof parsed.clientId !== 'string' || parsed.clientId === authUserId) return null;
    return { clientId: parsed.clientId, displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null };
  } catch {
    return null;
  }
}

function persistActing(authUserId: string, acting: ActingAs | null): void {
  try {
    if (acting) localStorage.setItem(actingKey(authUserId), JSON.stringify(acting));
    else localStorage.removeItem(actingKey(authUserId));
  } catch {
    // Storage unavailable: acting lasts for this page load only.
  }
}

/**
 * The identity a cold start resumes in. A workout in progress decides it: it
 * was started under one identity and switching is refused until it ends, so
 * the cache's owner is the only answer that cannot save it into the wrong
 * account. Otherwise the last choice made on this device.
 */
function initialActing(authUserId: string): ActingAs | null {
  const persisted = readPersistedActing(authUserId);
  const cacheOwner = workoutOwner(authUserId);
  if (!cacheOwner) return persisted;
  const acting = cacheOwner === authUserId
    ? null
    : { clientId: cacheOwner, displayName: persisted?.clientId === cacheOwner ? persisted.displayName : null };
  // Recorded, so the choice the workout made is also the next cold start's.
  persistActing(authUserId, acting);
  return acting;
}

/**
 * Start the next visit in the signed-in user's own account. For the share
 * page, which imports into the user's own library and then opens the app:
 * landing in a client's account would hide what was just saved. A workout in
 * progress for a client still decides, as it always does.
 */
export function resumeAsSelfNextTime(authUserId: string): void {
  persistActing(authUserId, null);
}

/**
 * Everything this device holds for one client: their drafts, their queued
 * template writes and the coach's conversations about them. Called when the
 * link ends, whichever side ended it, so none of it outlives the access.
 */
function forgetClientOnDevice(clientId: string): void {
  clearPendingTemplatesFor(clientId);
  forgetClientThreads(clientId);
  try {
    for (const base of USER_DRAFT_KEYS) localStorage.removeItem(ownerDraftKey(base, clientId));
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/**
 * Whose account the workout in progress on this device belongs to, or null
 * when there is none. A cache from before coach mode carries no owner and is
 * the signed-in user's.
 */
export function workoutOwner(authUserId: string | null): string | null {
  const cache = getSessionCache();
  if (!cache) return null;
  return cache.ownerUserId ?? authUserId;
}

const REFRESH_MIN_INTERVAL_MS = 60_000;

export function CoachProvider({ authUserId, children }: { authUserId: string; children: React.ReactNode }) {
  const [actingAs, setActingAs] = useState<ActingAs | null>(() => initialActing(authUserId));
  const [clients, setClients] = useState<CoachClient[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [ownTier, setOwnTier] = useState<SubscriptionTier | null>(null);
  const actingRef = useRef(actingAs);
  actingRef.current = actingAs;
  // The last clean answer from list_my_clients, or null before there is one.
  const clientsRef = useRef<CoachClient[] | null>(null);
  const lastRefresh = useRef(0);
  // Answers are applied in the order they were asked for, and none after the
  // provider is gone: a late, older list could otherwise end acting for a
  // client who was just linked, or rewrite the persisted identity after a
  // sign-out had cleared it.
  const refreshSeq = useRef(0);
  const appliedSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const setActing = useCallback((next: ActingAs | null) => {
    actingRef.current = next;
    setActingAs(next);
    persistActing(authUserId, next);
  }, [authUserId]);

  const refreshClients = useCallback(async () => {
    lastRefresh.current = Date.now();
    const seq = ++refreshSeq.current;
    const { data, error } = await supabase.rpc('list_my_clients');
    if (!mounted.current || seq < appliedSeq.current) return;
    // A failed read (offline at the gym) proves nothing about the link, so the
    // current identity stands; only a clean answer can end it.
    if (error || !data) return;
    appliedSeq.current = seq;
    const next: CoachClient[] = data.map(row => ({
      linkId: row.link_id,
      clientId: row.client_id,
      displayName: row.display_name ?? null,
      linkedAt: row.linked_at,
    }));
    const previous = clientsRef.current;
    clientsRef.current = next;
    setClients(next);
    setClientsLoaded(true);
    for (const gone of previous ?? []) {
      if (!next.some(c => c.clientId === gone.clientId)) forgetClientOnDevice(gone.clientId);
    }
    const acting = actingRef.current;
    if (!acting) return;
    const match = next.find(c => c.clientId === acting.clientId);
    if (!match) {
      setActing(null);
      forgetClientOnDevice(acting.clientId);
      toast.error(`You no longer have access to ${acting.displayName ?? 'that client'}'s account.`);
    } else if (match.displayName !== acting.displayName) {
      setActing({ clientId: acting.clientId, displayName: match.displayName });
    }
  }, [setActing]);

  useEffect(() => {
    void refreshClients();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh.current < REFRESH_MIN_INTERVAL_MS) return;
      void refreshClients();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshClients]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('user_id', authUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setOwnTier((data.subscription_tier as SubscriptionTier | null) ?? 'premium');
      });
    return () => { cancelled = true; };
  }, [authUserId]);

  // Refused while a workout is in progress, except towards the identity that
  // owns it: that is the way back to it from anywhere (another tab left in
  // the other identity, a cold start that could not resume in it). A workout
  // whose owner this coach can no longer reach (the client ended the link)
  // holds nothing back — there is no identity to protect it for, and Index
  // offers to keep or discard it.
  const switchTo = useCallback((next: ActingAs | null) => {
    const target = next?.clientId ?? authUserId;
    if ((actingRef.current?.clientId ?? authUserId) === target) return true;
    // A live workout writes its cache half a second after it opens; until then
    // the mounted screen is the only sign of it, and it is this identity's.
    const owner = workoutOwner(authUserId)
      ?? (isSessionActive() ? actingRef.current?.clientId ?? authUserId : null);
    const known = clientsRef.current;
    const reachable = !!owner && (owner === authUserId || !known || known.some(c => c.clientId === owner));
    if (owner && reachable && owner !== target) {
      toast.error(SWITCH_BLOCKED_MESSAGE);
      // The refusal may rest on a client list that is out of date (the client
      // ended the link a moment ago). Asking again ends acting by itself if so,
      // and the workout then offers Keep or Discard from the coach's account.
      if (owner !== authUserId) void refreshClients();
      return false;
    }
    setActing(next);
    return true;
  }, [authUserId, setActing, refreshClients]);

  const actAs = useCallback(
    (client: ActingAs) => switchTo(client.clientId === authUserId ? null : client),
    [authUserId, switchTo],
  );
  const stopActing = useCallback(() => switchTo(null), [switchTo]);

  const accessLost = useCallback((clientId: string) => {
    const acting = actingRef.current;
    if (!acting || acting.clientId !== clientId) return;
    setActing(null);
    forgetClientOnDevice(clientId);
    toast.error(`You no longer have access to ${acting.displayName ?? 'that client'}'s account.`);
    void refreshClients();
  }, [setActing, refreshClients]);

  const value = useMemo<CoachContextValue>(() => ({
    authUserId,
    ownerId: actingAs?.clientId ?? authUserId,
    actingAs,
    clients,
    clientsLoaded,
    ownTier,
    refreshClients,
    actAs,
    stopActing,
    accessLost,
  }), [authUserId, actingAs, clients, clientsLoaded, ownTier, refreshClients, actAs, stopActing, accessLost]);

  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>;
}

const noop = () => {};
const asyncNoop = async () => {};

/**
 * The coach context, or — outside a provider (tests, and anything rendered
 * outside the signed-in shell) — the signed-in user acting as themselves.
 */
export function useCoach(): CoachContextValue {
  const ctx = useContext(CoachContext);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const fallback = useMemo<CoachContextValue>(() => ({
    authUserId: userId,
    ownerId: userId,
    actingAs: null,
    clients: [],
    clientsLoaded: false,
    ownTier: null,
    refreshClients: asyncNoop,
    actAs: () => false,
    stopActing: () => true,
    accessLost: noop,
  }), [userId]);
  return ctx ?? fallback;
}

/** The localStorage key for a draft of the account on screen (see `ownerDraftKey`). */
export function useOwnerDraftKey(base: string): string {
  const { actingAs } = useCoach();
  return ownerDraftKey(base, actingAs?.clientId);
}
