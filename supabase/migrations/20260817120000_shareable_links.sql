-- Shareable links for completed sessions, templates, and programs.
--
-- Each row is a FROZEN SNAPSHOT: `payload` carries everything the public page
-- needs to render, so a viewer never reads the sharer's live tables and later
-- edits to the source never mutate an already-published link.

CREATE TABLE public.shares (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 32 hex chars / 122 bits of entropy. gen_random_bytes() would be shorter,
  -- but it is pgcrypto, which lives in the `extensions` schema — it would not
  -- resolve under the reader function's `SET search_path = public`.
  token       text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('session', 'template', 'program')),
  -- Deliberately not a foreign key: a snapshot must outlive the template,
  -- program, or session it was taken from.
  source_id   uuid,
  title       text NOT NULL,
  payload     jsonb NOT NULL,
  revoked_at  timestamptz,
  view_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shares_user_created_idx ON public.shares (user_id, created_at DESC);

-- At most one live share per source, so re-sharing updates in place and the
-- published URL stays stable. Revoked rows are excluded, which lets a source
-- be shared again after its previous link was killed.
CREATE UNIQUE INDEX shares_live_source_idx
  ON public.shares (user_id, kind, source_id)
  WHERE revoked_at IS NULL AND source_id IS NOT NULL;

ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

-- Owner-only. There is deliberately NO anon SELECT policy: an anon policy
-- would let anyone enumerate every share in the table. The sole public read
-- path is get_shared_item() below, which is token-scoped.
CREATE POLICY "Users can view their own shares"
ON public.shares FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own shares"
ON public.shares FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own shares"
ON public.shares FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own shares"
ON public.shares FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_shares_updated_at
BEFORE UPDATE ON public.shares
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- get_shared_item — the single public read path. SECURITY DEFINER so it can
-- see past the owner-only policies above, but it looks up by token alone and
-- returns a narrow column list: user_id and view_count never leave the DB.
--
-- A revoked share still resolves, returning revoked = true with a null
-- payload, so the viewer gets "this link is no longer available" rather than
-- a not-found page that reads like a bug. An unknown token returns no rows,
-- which is also the right answer for someone probing for valid tokens.
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.shares%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.shares s WHERE s.token = p_token;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT v_row.kind, v_row.title, NULL::jsonb, true,
                        v_row.created_at, v_row.updated_at;
    RETURN;
  END IF;

  -- Best-effort view counter, deliberately last and deliberately not returned
  -- to the caller. This makes the function VOLATILE, so it has to be invoked
  -- over POST — which supabase-js .rpc() already does.
  UPDATE public.shares SET view_count = view_count + 1 WHERE id = v_row.id;

  RETURN QUERY SELECT v_row.kind, v_row.title, v_row.payload, false,
                      v_row.created_at, v_row.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_item(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_item(text) TO anon, authenticated;
