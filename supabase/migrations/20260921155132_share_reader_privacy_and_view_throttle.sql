-- The anonymous shared-link reader: what a revoked link may reveal, and what
-- an anonymous hit may write (audit 13.9 and 13.10).
--
-- Both items land on public.get_shared_item, the SECURITY DEFINER function that
-- is the *only* public read path into public.shares (the table itself is
-- owner-only under RLS, with no anon policy, because an anon SELECT would let
-- anyone dump every share). Its SECURITY DEFINER setting, its
-- `SET search_path = public`, and its grant to anon are all unchanged here.
--
-- 13.9 — A REVOKED LINK STILL GAVE AWAY ITS NAME AND DATES.
-- The revoked branch returned kind, title, created_at and updated_at with a
-- null payload. The public page already renders that as "this link is no
-- longer available", but anyone still holding the old URL could read the
-- item's title and when it was shared and last changed straight out of the
-- RPC. Revoking is the user's one lever for cutting off access, so it now
-- means the link reveals nothing but the fact that it was revoked: the row
-- comes back with `revoked = true` and every other column null.
--
-- The result *shape* is deliberately unchanged (same six columns, same types),
-- so nothing about the non-revoked path or the client's parsing moves.
-- src/pages/SharedItem.tsx reads `row.revoked` first and returns before it
-- touches title, kind or the timestamps, so the revoked screen renders exactly
-- as it did. An unknown token still returns no rows at all, which stays the
-- right answer for someone probing for valid tokens.
--
-- 13.10 — EVERY ANONYMOUS HIT WROTE TO THE TABLE.
-- The counter was an unconditional `UPDATE ... SET view_count = view_count + 1`
-- per call. Two consequences:
--
--   * The count was not a count of views. A refresh, a back-navigation, and
--     every link preview fetched by a chat app, a crawler or a link scanner
--     each added one — and unfurlers routinely fetch the same URL several
--     times in a row.
--   * Every one of those hits fired the `update_shares_updated_at` trigger, so
--     updated_at tracked "when a stranger last loaded this" rather than "when
--     the owner last changed this share", which is what the column is for and
--     the only thing anything should read it as.
--
-- The fix is a per-link throttle plus a trigger that ignores a view.
--
-- WINDOW: one hour, per link. An hour is long enough to swallow the whole
-- burst that one act of sharing produces — the sender's own check of the link,
-- the unfurl, a crawler, and the recipient refreshing — and short enough that
-- opening a link on Monday and again on Tuesday still reads as two views. It
-- is deliberately per *link*, not per viewer: this function runs unauthenticated
-- and has no trustworthy viewer identity to key on (no session, and no client
-- IP that a caller could not set), and inventing one would mean storing
-- something about anonymous readers, which this feature has so far avoided.
--
-- The honest description of the resulting number is therefore "how many
-- separate hours this link was opened in", not a tally of views: ten people
-- opening it in the same hour count once, and one person opening it ten times
-- also counts once. It is an approximation, and a lower bound. The screen that
-- shows it (SharedLinksScreen) presents it as a rough signal of reach, which
-- this still serves — better than the old number, which was an over-count of
-- unknown size dominated by robots.

-- 1. Where the throttle keeps its state. NULL means "no view has been counted
--    under this rule yet", which is the right starting point for every
--    existing row: the next real open counts.
ALTER TABLE public.shares
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

COMMENT ON COLUMN public.shares.last_viewed_at IS
  'When a view was last counted for this link (not when it was last fetched). Drives the one-hour view-count throttle in get_shared_item; never returned to the public reader.';

COMMENT ON COLUMN public.shares.view_count IS
  'Approximate reach: the number of distinct one-hour windows in which this link was opened, not a tally of requests. See get_shared_item.';

COMMENT ON COLUMN public.shares.updated_at IS
  'When the OWNER last changed this share (re-share, revoke). A counted view deliberately does not touch it.';

-- 2. A counted view must not read as an edit.
--
--    update_shares_updated_at is the shared update_updated_at_column() trigger,
--    which is used by many tables and is left alone; what changes is *when* it
--    fires on this one. The WHEN clause below is written so that the default is
--    to bump: the only update that skips the bump is one that changed a view
--    column and changed none of the owner-editable columns, which is exactly
--    the statement in get_shared_item and nothing else.
--
--    A column added to this table later keeps bumping updated_at when it is
--    edited on its own (the first disjunct sees the view columns untouched). If
--    a future statement ever writes a new column *together with* a view bump,
--    add it to the second list.
DROP TRIGGER IF EXISTS update_shares_updated_at ON public.shares;

CREATE TRIGGER update_shares_updated_at
BEFORE UPDATE ON public.shares
FOR EACH ROW
WHEN (
  (OLD.view_count, OLD.last_viewed_at) IS NOT DISTINCT FROM (NEW.view_count, NEW.last_viewed_at)
  OR (OLD.token, OLD.user_id, OLD.kind, OLD.source_id, OLD.title, OLD.payload, OLD.revoked_at)
     IS DISTINCT FROM
     (NEW.token, NEW.user_id, NEW.kind, NEW.source_id, NEW.title, NEW.payload, NEW.revoked_at)
)
EXECUTE FUNCTION public.update_updated_at_column();

-- 3. The reader itself.
CREATE OR REPLACE FUNCTION public.get_shared_item(p_token text)
RETURNS TABLE (
  kind       text,
  title      text,
  payload    jsonb,
  revoked    boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
-- VOLATILE (the default) on purpose, even though most calls now write nothing:
-- it is what makes PostgREST invoke this over POST rather than a cacheable GET.
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- One hour. See the note at the top of this migration for why, and for what
  -- the resulting view_count does and does not mean.
  c_view_window CONSTANT interval := interval '1 hour';
  v_row public.shares%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.shares s WHERE s.token = p_token;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A revoked link reveals that it was revoked and nothing else: no title, no
  -- kind, no dates (audit 13.9). The row is still returned, so the viewer gets
  -- "no longer available" rather than a not-found page that reads like a bug.
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::jsonb, true,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- Best-effort view counter, deliberately not returned to the caller and
  -- throttled to at most one per link per window. The outer IF is what keeps
  -- the ordinary hit read-only: without it every anonymous request would take a
  -- row lock and they would serialize behind each other. The same predicate is
  -- repeated inside the UPDATE because two requests can pass the IF at once —
  -- the second then blocks on the row lock and re-evaluates the WHERE against
  -- the version the first one wrote, and counts nothing.
  IF v_row.last_viewed_at IS NULL
     OR v_row.last_viewed_at <= now() - c_view_window THEN
    UPDATE public.shares s
       SET view_count = s.view_count + 1,
           last_viewed_at = now()
     WHERE s.id = v_row.id
       AND (s.last_viewed_at IS NULL OR s.last_viewed_at <= now() - c_view_window);
  END IF;

  RETURN QUERY SELECT v_row.kind, v_row.title, v_row.payload, false,
                      v_row.created_at, v_row.updated_at;
END;
$$;

-- Unchanged, restated because CREATE OR REPLACE does not touch grants and this
-- is the single public read path the feature depends on.
REVOKE ALL ON FUNCTION public.get_shared_item(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_item(text) TO anon, authenticated;
