import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCoach } from '@/contexts/CoachContext';
import type { CoachActivityRow } from '@/utils/coachActivity';

/**
 * The signed-in user's own side of coach mode: their invite code, the coaches
 * they have, and the log of what those coaches changed. Keyed on `authUserId`,
 * never `ownerId` — a coach acting as a client must still see and manage
 * their own coaches here, not the client's.
 */

export interface LiveInvite {
  code: string;
  expiresAt: string;
}

export interface MyCoach {
  linkId: string;
  coachId: string;
  displayName: string | null;
  linkedAt: string;
}

export type RedeemResult =
  | { ok: true; clientId: string; clientName: string | null }
  | { ok: false; message: string };

export const ACTIVITY_PAGE_SIZE = 50;

const ACTIVITY_COLUMNS =
  'id, client_id, coach_id, coach_name, table_name, action, row_count, labels, changed_fields, created_at';

/**
 * Whether a display name can be shown to a client as their coach's name. The
 * server refuses a link otherwise (redeem_coach_invite): sign-up seeds the
 * display name with the email address, which is not a name to show anyone.
 */
export function isUsableCoachName(name: string | null | undefined): boolean {
  return !!name && name.trim().length > 0 && !name.includes('@');
}

export const COACH_NAME_MAX = 80;

export function normaliseInviteCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function formatInviteCode(code: string): string {
  const clean = normaliseInviteCode(code);
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

/**
 * Deletes one coach link by id, from either side. RLS refuses a delete by
 * matching no rows rather than by erroring, so only a returned row counts.
 */
export async function endCoachLink(linkId: string): Promise<boolean> {
  const { data, error } = await supabase.from('coach_links').delete().eq('id', linkId).select('id');
  if (error) {
    console.error('[useCoachLinks] end link failed:', error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export async function redeemCoachInvite(rawCode: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_coach_invite', { p_code: rawCode });
  if (error) return { ok: false, message: error.message || 'Could not connect. Try again.' };
  const row = data?.[0];
  if (!row) return { ok: false, message: 'Could not connect. Try again.' };
  return { ok: true, clientId: row.client_id, clientName: row.client_name ?? null };
}

export function useCoachLinks() {
  const { authUserId } = useCoach();

  const [invite, setInvite] = useState<LiveInvite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  const [coaches, setCoaches] = useState<MyCoach[]>([]);
  const [coachesLoading, setCoachesLoading] = useState(true);
  const [coachesError, setCoachesError] = useState(false);

  const [activity, setActivity] = useState<CoachActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState(false);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const activityOffset = useRef(0);
  const activityInFlight = useRef(false);

  // A response that lands after the account changed (or the screen left)
  // belongs to an identity this hook no longer shows.
  const generation = useRef(0);

  const loadInvite = useCallback(async () => {
    const gen = generation.current;
    if (!authUserId) { setInvite(null); setInviteLoading(false); return; }
    setInviteLoading(true);
    const { data, error } = await supabase
      .from('coach_invites')
      .select('code, created_at, expires_at, redeemed_at, redeemed_by')
      .eq('client_id', authUserId)
      .is('redeemed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gen !== generation.current) return;
    setInviteLoading(false);
    if (error) {
      console.error('[useCoachLinks] invite load failed:', error);
      setInviteError(true);
      return;
    }
    setInviteError(false);
    setInvite(data ? { code: data.code, expiresAt: data.expires_at } : null);
  }, [authUserId]);

  const loadCoaches = useCallback(async () => {
    const gen = generation.current;
    if (!authUserId) { setCoaches([]); setCoachesLoading(false); return; }
    const { data, error } = await supabase.rpc('list_my_coaches');
    if (gen !== generation.current) return;
    setCoachesLoading(false);
    if (error || !data) {
      if (error) console.error('[useCoachLinks] coaches load failed:', error);
      setCoachesError(true);
      return;
    }
    setCoachesError(false);
    setCoaches(data.map(row => ({
      linkId: row.link_id,
      coachId: row.coach_id,
      displayName: row.display_name ?? null,
      linkedAt: row.linked_at,
    })));
  }, [authUserId]);

  const fetchActivityPage = useCallback(async (reset: boolean) => {
    if (!authUserId) { setActivity([]); setActivityLoading(false); setActivityHasMore(false); return; }
    if (activityInFlight.current && !reset) return;
    activityInFlight.current = true;
    const gen = generation.current;
    const from = reset ? 0 : activityOffset.current;
    setActivityLoading(true);
    const { data, error } = await supabase
      .from('coach_activity')
      .select(ACTIVITY_COLUMNS)
      .eq('client_id', authUserId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + ACTIVITY_PAGE_SIZE - 1);
    if (gen !== generation.current) return;
    activityInFlight.current = false;
    setActivityLoading(false);
    if (error || !data) {
      if (error) console.error('[useCoachLinks] activity load failed:', error);
      setActivityError(true);
      return;
    }
    setActivityError(false);
    activityOffset.current = from + data.length;
    setActivityHasMore(data.length === ACTIVITY_PAGE_SIZE);
    // Offset pages shift when a new row lands between them; dedupe on id so
    // the overlap repeats nothing.
    setActivity(prev => {
      if (reset) return data;
      const seen = new Set(prev.map(r => r.id));
      return [...prev, ...data.filter(r => !seen.has(r.id))];
    });
  }, [authUserId]);

  const refreshActivity = useCallback(() => fetchActivityPage(true), [fetchActivityPage]);
  const loadMoreActivity = useCallback(() => fetchActivityPage(false), [fetchActivityPage]);

  useEffect(() => {
    generation.current += 1;
    activityInFlight.current = false;
    activityOffset.current = 0;
    setInviteBusy(false);
    void loadInvite();
    void loadCoaches();
    void fetchActivityPage(true);
    return () => { generation.current += 1; };
  }, [loadInvite, loadCoaches, fetchActivityPage]);

  const createInvite = useCallback(async (): Promise<boolean> => {
    if (!authUserId || inviteBusy) return false;
    setInviteBusy(true);
    const gen = generation.current;
    const { data, error } = await supabase.rpc('create_coach_invite');
    if (gen !== generation.current) return false;
    setInviteBusy(false);
    const row = data?.[0];
    if (error || !row) {
      if (error) console.error('[useCoachLinks] create invite failed:', error);
      return false;
    }
    setInviteError(false);
    setInvite({ code: row.invite_code, expiresAt: row.invite_expires_at });
    return true;
  }, [authUserId, inviteBusy]);

  const cancelInvite = useCallback(async (): Promise<boolean> => {
    if (!authUserId || !invite || inviteBusy) return false;
    setInviteBusy(true);
    const gen = generation.current;
    const { data, error } = await supabase
      .from('coach_invites')
      .delete()
      .eq('client_id', authUserId)
      .eq('code', invite.code)
      .select('code');
    if (gen !== generation.current) return false;
    setInviteBusy(false);
    if (error || (data?.length ?? 0) === 0) {
      if (error) console.error('[useCoachLinks] cancel invite failed:', error);
      // Nothing deleted can also mean the code was redeemed meanwhile.
      void loadInvite();
      void loadCoaches();
      return false;
    }
    setInvite(null);
    return true;
  }, [authUserId, invite, inviteBusy, loadInvite, loadCoaches]);

  const removeCoach = useCallback(async (linkId: string): Promise<boolean> => {
    const ok = await endCoachLink(linkId);
    if (ok) {
      setCoaches(prev => prev.filter(c => c.linkId !== linkId));
      void refreshActivity();
    } else {
      void loadCoaches();
    }
    return ok;
  }, [loadCoaches, refreshActivity]);

  return {
    authUserId,
    invite,
    inviteLoading,
    inviteError,
    inviteBusy,
    createInvite,
    cancelInvite,
    reloadInvite: loadInvite,
    coaches,
    coachesLoading,
    coachesError,
    removeCoach,
    reloadCoaches: loadCoaches,
    activity,
    activityLoading,
    activityError,
    activityHasMore,
    loadMoreActivity,
    refreshActivity,
  };
}
