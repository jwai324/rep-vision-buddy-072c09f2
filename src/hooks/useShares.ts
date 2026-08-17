import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { ShareKind, ShareListItem, ShareSnapshot } from '@/types/share';
import type { Database } from '@/integrations/supabase/types';

type ShareRow = Database['public']['Tables']['shares']['Row'];

/**
 * Shares deliberately live outside `useStorage`. That hook mirrors its whole
 * state to localStorage on every settle, so putting snapshot payloads in it
 * would mean a CACHE_VERSION bump and a chunk of the cache budget spent on
 * data no screen needs on a cold paint. Shares are read on demand instead.
 */

/** Payload is never selected for the list — it is the big column and no row needs it. */
const LIST_COLUMNS = 'id, token, kind, title, source_id, revoked_at, view_count, created_at, updated_at';

// A share of a program embedding many templates is still only a few tens of KB.
// A megabyte means something has gone wrong upstream; fail with a readable
// message rather than letting an opaque jsonb write error surface.
const MAX_PAYLOAD_BYTES = 1_000_000;

function mapShare(row: Pick<ShareRow, 'id' | 'token' | 'kind' | 'title' | 'source_id' | 'revoked_at' | 'view_count' | 'created_at' | 'updated_at'>): ShareListItem {
  return {
    id: row.id,
    token: row.token,
    kind: row.kind as ShareKind,
    title: row.title,
    sourceId: row.source_id,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function shareUrlFor(token: string): string {
  return `${window.location.origin}/s/${token}`;
}

interface UseSharesOptions {
  /**
   * Load the owner's share list on mount. The Shared Links screen wants this;
   * ShareDialog does not — it is mounted for the whole app session and only
   * ever needs the write helpers, so it would otherwise cost a list query on
   * every cold load.
   */
  autoFetch?: boolean;
}

export function useShares({ autoFetch = true }: UseSharesOptions = {}) {
  const { user } = useAuth();
  // Keyed on the id, not the user object — a token refresh hands back a fresh
  // object and would otherwise refetch the list on every tab refocus.
  const userId = user?.id ?? null;
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [loading, setLoading] = useState(autoFetch);

  const fetchShares = useCallback(async () => {
    if (!userId) { setShares([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('shares')
      .select(LIST_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[useShares] fetch error:', error);
      setLoading(false);
      return;
    }
    setShares((data ?? []).map(mapShare));
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (autoFetch) fetchShares(); }, [autoFetch, fetchShares]);

  // Only worth re-reading when something is showing the list.
  const refreshList = useCallback(async () => {
    if (autoFetch) await fetchShares();
  }, [autoFetch, fetchShares]);

  /**
   * Publish or republish a snapshot. A live share for the same source is
   * updated in place so the URL the user already sent stays valid and simply
   * starts serving the newer content.
   */
  const createOrUpdateShare = useCallback(async (args: {
    kind: ShareKind;
    sourceId: string;
    title: string;
    payload: ShareSnapshot;
  }): Promise<string | null> => {
    if (!userId) return null;

    const serialized = JSON.stringify(args.payload);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      toast.error('This is too large to share.');
      return null;
    }

    const { data: existing, error: lookupError } = await supabase
      .from('shares')
      .select('id, token')
      .eq('user_id', userId)
      .eq('kind', args.kind)
      .eq('source_id', args.sourceId)
      .is('revoked_at', null)
      .maybeSingle();

    if (lookupError) {
      console.error('[useShares] lookup error:', lookupError);
      toast.error('Could not create a link');
      return null;
    }

    if (existing) {
      const { error } = await supabase
        .from('shares')
        .update({ title: args.title, payload: JSON.parse(serialized) })
        .eq('id', existing.id);
      if (error) {
        console.error('[useShares] update error:', error);
        toast.error('Could not update the link');
        return null;
      }
      await refreshList();
      return existing.token;
    }

    const { data, error } = await supabase
      .from('shares')
      .insert({
        user_id: userId,
        kind: args.kind,
        source_id: args.sourceId,
        title: args.title,
        payload: JSON.parse(serialized),
      })
      .select('token')
      .single();

    if (error || !data) {
      console.error('[useShares] insert error:', error);
      toast.error('Could not create a link');
      return null;
    }
    await refreshList();
    return data.token;
  }, [userId, refreshList]);

  /** Look up the live share for a source without creating one. */
  const findLiveShare = useCallback(async (kind: ShareKind, sourceId: string): Promise<string | null> => {
    if (!userId) return null;
    const { data } = await supabase
      .from('shares')
      .select('token')
      .eq('user_id', userId)
      .eq('kind', kind)
      .eq('source_id', sourceId)
      .is('revoked_at', null)
      .maybeSingle();
    return data?.token ?? null;
  }, [userId]);

  const revokeShare = useCallback(async (id: string): Promise<boolean> => {
    if (!userId) return false;
    const { error } = await supabase
      .from('shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) {
      console.error('[useShares] revoke error:', error);
      toast.error('Could not revoke the link');
      return false;
    }
    toast.success('Link revoked');
    await refreshList();
    return true;
  }, [userId, refreshList]);

  return { shares, loading, refetch: fetchShares, createOrUpdateShare, findLiveShare, revokeShare };
}
