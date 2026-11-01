-- Coach mode.
--
-- A client hands another account a one-time code; whoever redeems it becomes
-- that client's coach and gets full read and write on the client's workout
-- data, through the coach's own session. Nothing about the client's own
-- access changes, and an account with no coach links behaves exactly as it
-- did before this migration: every policy added here is permissive and
-- additive, and its predicate is empty for anyone who coaches nobody.
--
-- What a coach can reach: profiles, user_settings, workout_programs,
-- workout_templates, future_workouts, workout_sessions, body_measurements,
-- custom_exercises — the same commands the owner has on each (profiles and
-- user_settings have no DELETE for anyone). What stays the client's alone:
-- credits and billing (user_token_balance, token_ledger, iap_purchases,
-- user_ai_usage), public share links (shares) and bug reports
-- (error_reports). Those tables get no coach policy at all.
--
-- Every write a coach makes is recorded in coach_activity by statement-level
-- triggers, so the client can see what was changed and by whom. The record
-- is written by the database, not the app, so nothing a coach's client does
-- can skip it.

-- 1. Links -----------------------------------------------------------------

CREATE TABLE public.coach_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_links_pair_unique UNIQUE (coach_id, client_id),
  CONSTRAINT coach_links_not_self CHECK (coach_id <> client_id)
);
-- (coach_id, client_id) is covered by the unique index; the client side needs
-- its own for "my coaches" and for the cascade on account deletion.
CREATE INDEX coach_links_client_id_idx ON public.coach_links (client_id);

ALTER TABLE public.coach_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_links FROM anon, authenticated;
-- Links are created only by redeem_coach_invite, never by a direct insert,
-- so a coach cannot grant themselves a client.
GRANT SELECT, DELETE ON public.coach_links TO authenticated;

CREATE POLICY "Either party can see a coach link"
  ON public.coach_links FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (coach_id, client_id));
CREATE POLICY "Either party can end a coach link"
  ON public.coach_links FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) IN (coach_id, client_id));

-- 2. Invite codes ----------------------------------------------------------

-- Ten characters from a 32-letter alphabet with no 0/O or 1/I: 50 bits, live
-- for seven days, one live code per client, single use. A redeemed code is
-- full access to an account, and redeem_coach_invite has no attempt limit (a
-- failed attempt raises, which would roll back any counter it wrote), so the
-- space is what makes guessing hopeless: with a hundred live codes at a
-- thousand guesses a second, the expected time to a hit is centuries.
CREATE TABLE public.coach_invites (
  code text PRIMARY KEY CHECK (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX coach_invites_client_id_idx ON public.coach_invites (client_id);

ALTER TABLE public.coach_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_invites FROM anon, authenticated;
GRANT SELECT, DELETE ON public.coach_invites TO authenticated;

CREATE POLICY "Clients can see their own invite codes"
  ON public.coach_invites FOR SELECT TO authenticated
  USING (client_id = (SELECT auth.uid()));
CREATE POLICY "Clients can cancel their own invite codes"
  ON public.coach_invites FOR DELETE TO authenticated
  USING (client_id = (SELECT auth.uid()));

-- 3. Activity log ----------------------------------------------------------

-- One row per statement a coach ran against a client's data, not per row: a
-- saved program rewrites hundreds of scheduled rows in one insert, and the
-- client wants "added 84 scheduled workouts", not 84 lines.
-- coach_name is a snapshot so the record still reads after the coach's
-- account is gone (coach_id goes null then; client_id cascades with the
-- client, whose record it is).
CREATE TABLE public.coach_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  coach_name text,
  table_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'linked', 'unlinked')),
  row_count integer NOT NULL DEFAULT 1,
  labels text[] NOT NULL DEFAULT '{}',
  changed_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coach_activity_client_created_idx ON public.coach_activity (client_id, created_at DESC, id);
CREATE INDEX coach_activity_coach_id_idx ON public.coach_activity (coach_id);

ALTER TABLE public.coach_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_activity FROM anon, authenticated;
-- Written only by the SECURITY DEFINER functions below. Nobody but the
-- service role can edit or delete it, which is the point of a record.
GRANT SELECT ON public.coach_activity TO authenticated;

CREATE POLICY "Clients see activity on their account; coaches see their own"
  ON public.coach_activity FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (client_id, coach_id));

-- 4. Coach access to client data -------------------------------------------

-- The predicate is a subquery rather than a function call so the planner
-- runs it once per statement as a hashed subplan, not once per row; the
-- unique (coach_id, client_id) index answers it. It reads coach_links under
-- that table's own RLS, which lets a coach see exactly their own links.
DO $$
DECLARE
  v_pred constant text :=
    'user_id IN (SELECT cl.client_id FROM public.coach_links cl WHERE cl.coach_id = (SELECT auth.uid()))';
  r record;
  v_cmd text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('profiles',          ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('user_settings',     ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('workout_programs',  ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      ('workout_templates', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      ('future_workouts',   ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      ('workout_sessions',  ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      ('body_measurements', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      ('custom_exercises',  ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
    ) AS t(tbl, cmds)
  LOOP
    FOREACH v_cmd IN ARRAY r.cmds LOOP
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR %s TO authenticated %s',
        'Coaches can ' || lower(v_cmd) || ' their clients'' rows',
        r.tbl,
        v_cmd,
        CASE v_cmd
          WHEN 'INSERT' THEN format('WITH CHECK (%s)', v_pred)
          WHEN 'UPDATE' THEN format('USING (%s) WITH CHECK (%s)', v_pred, v_pred)
          ELSE format('USING (%s)', v_pred)
        END
      );
    END LOOP;
  END LOOP;
END;
$$;

-- 5. Write guard -----------------------------------------------------------

-- Three things RLS cannot express, because a policy sees only the new row:
--
-- * A row never changes owner. UPDATE policies OR together, so with a coach
--   policy in place a coach could otherwise re-point a client's row at their
--   own account (the owner policy's WITH CHECK passes) or at another client.
-- * A row never changes id. The activity log pairs an UPDATE's old and new
--   rows by id, so a re-keyed row would be rewritten with no record of it;
--   and templates, sessions and programs refer to each other by id in text
--   and JSON that no foreign key follows.
--   No caller has ever needed to change either column (upserts conflict on
--   them), so both rules apply to everyone with a JWT; the service role
--   (auth.uid() null) is left alone.
-- * A coach cannot change a client's subscription tier. The tier is billing,
--   which stays the client's. The client's own write path (the plan toggle on
--   the credits screen) is untouched. A coach's INSERT — which every upsert
--   starts as, even onto an existing row — has its tier replaced by the
--   client's current one (or 'free' for a client with no profile row), so
--   neither an omitted tier nor a supplied one can set the plan.
CREATE OR REPLACE FUNCTION public.coach_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'a row cannot be moved to another account' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a row''s id cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'profiles' AND NEW.user_id IS DISTINCT FROM v_actor THEN
    IF TG_OP = 'UPDATE' AND NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
      RAISE EXCEPTION 'a coach cannot change a client''s plan' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.subscription_tier := coalesce(
        (SELECT p.subscription_tier FROM profiles p WHERE p.user_id = NEW.user_id),
        'free'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.coach_write_guard() FROM PUBLIC, anon, authenticated;

-- 6. Activity triggers -----------------------------------------------------

-- Statement-level, with transition tables, so one coach statement is one
-- record however many rows it touched. Labels are what a person would call
-- the rows (a template's name, a session's date); changed_fields names the
-- columns an UPDATE actually changed. An update that changed nothing but
-- updated_at — an upsert of identical values — is not recorded.
--
-- Rows whose owner is the actor are the actor's own data and are skipped, so
-- a coach working on their own account writes nothing here. The service role
-- (auth.uid() null: edge functions, the dashboard, an account deletion's
-- cascade) is skipped outright.
CREATE OR REPLACE FUNCTION public.log_coach_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM coach_links WHERE coach_id = v_actor) THEN
    RETURN NULL;
  END IF;
  SELECT left(display_name, 80) INTO v_name FROM profiles WHERE user_id = v_actor;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO coach_activity (client_id, coach_id, coach_name, table_name, action, row_count, labels)
    SELECT r.user_id, v_actor, v_name, TG_TABLE_NAME, 'insert', count(*),
           coalesce((array_agg(DISTINCT r.label) FILTER (WHERE r.label IS NOT NULL))[1:5], '{}')
      FROM (SELECT n.user_id,
                   left(coalesce(to_jsonb(n) ->> 'name', to_jsonb(n) ->> 'date'), 80) AS label
              FROM new_rows n) r
     WHERE r.user_id IS DISTINCT FROM v_actor
     GROUP BY r.user_id;

  ELSIF TG_OP = 'UPDATE' THEN
    WITH pairs AS (
      SELECT n.user_id, to_jsonb(n) AS nj, to_jsonb(o) AS oj
        FROM new_rows n
        JOIN old_rows o ON o.id = n.id
       WHERE n.user_id IS DISTINCT FROM v_actor
         AND (to_jsonb(n) - 'updated_at') IS DISTINCT FROM (to_jsonb(o) - 'updated_at')
    ), changed AS (
      SELECT DISTINCT p.user_id, e.key
        FROM pairs p, jsonb_each(p.nj) AS e(key, value)
       WHERE e.key NOT IN ('updated_at', 'created_at')
         AND e.value IS DISTINCT FROM p.oj -> e.key
    )
    INSERT INTO coach_activity (client_id, coach_id, coach_name, table_name, action, row_count, labels, changed_fields)
    SELECT p.user_id, v_actor, v_name, TG_TABLE_NAME, 'update', count(*),
           coalesce((array_agg(DISTINCT left(coalesce(p.nj ->> 'name', p.nj ->> 'date'), 80))
                     FILTER (WHERE coalesce(p.nj ->> 'name', p.nj ->> 'date') IS NOT NULL))[1:5], '{}'),
           coalesce((SELECT array_agg(c.key ORDER BY c.key) FROM changed c WHERE c.user_id = p.user_id), '{}')
      FROM pairs p
     GROUP BY p.user_id;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO coach_activity (client_id, coach_id, coach_name, table_name, action, row_count, labels)
    SELECT r.user_id, v_actor, v_name, TG_TABLE_NAME, 'delete', count(*),
           coalesce((array_agg(DISTINCT r.label) FILTER (WHERE r.label IS NOT NULL))[1:5], '{}')
      FROM (SELECT o.user_id,
                   left(coalesce(to_jsonb(o) ->> 'name', to_jsonb(o) ->> 'date'), 80) AS label
              FROM old_rows o) r
     WHERE r.user_id IS DISTINCT FROM v_actor
     GROUP BY r.user_id;
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_coach_activity() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'user_settings', 'workout_programs', 'workout_templates',
    'future_workouts', 'workout_sessions', 'body_measurements', 'custom_exercises'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER coach_write_guard BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.coach_write_guard()', t);
    EXECUTE format(
      'CREATE TRIGGER coach_activity_insert AFTER INSERT ON public.%I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.log_coach_activity()', t);
    EXECUTE format(
      'CREATE TRIGGER coach_activity_update AFTER UPDATE ON public.%I
         REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.log_coach_activity()', t);
    EXECUTE format(
      'CREATE TRIGGER coach_activity_delete AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.log_coach_activity()', t);
  END LOOP;
END;
$$;

-- Ending a link is recorded too, by whichever party ended it. Only a delete
-- made by one of the two parties is logged: an account deletion cascades
-- with no JWT (auth.uid() null), and inserting a row that points at the
-- account being deleted would fail that deletion's foreign-key check.
CREATE OR REPLACE FUNCTION public.log_coach_link_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR v_actor NOT IN (OLD.coach_id, OLD.client_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO coach_activity (client_id, coach_id, coach_name, table_name, action, labels)
  VALUES (
    OLD.client_id,
    OLD.coach_id,
    (SELECT left(display_name, 80) FROM profiles WHERE user_id = OLD.coach_id),
    'coach_links',
    'unlinked',
    ARRAY[CASE WHEN v_actor = OLD.client_id THEN 'removed by client' ELSE 'left by coach' END]
  );
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.log_coach_link_ended() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER coach_link_ended AFTER DELETE ON public.coach_links
  FOR EACH ROW EXECUTE FUNCTION public.log_coach_link_ended();

-- 7. A calendar row and its program belong to the same account ------------

-- future_workouts.program_id referenced workout_programs(id) alone, and
-- foreign-key checks and cascades ignore RLS. So a coach could re-point a
-- client's calendar rows at a program of the coach's own and, after the link
-- ended, delete that program — and the cascade would delete the client's
-- rows, completed history included, with no coach policy involved and nothing
-- logged. A second reference keyed on (id, user_id) makes it impossible for a
-- row to point at another account's program at all. The original
-- program_id-only key stays: with this one in place every row it cascades
-- from is the same account's anyway, so dropping it would gain nothing.
-- Existing rows all agree (checked on production before this was written:
-- 0 mismatched, 0 orphans).
ALTER TABLE public.workout_programs
  ADD CONSTRAINT workout_programs_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE public.future_workouts
  ADD CONSTRAINT future_workouts_program_owner_fkey
  FOREIGN KEY (program_id, user_id) REFERENCES public.workout_programs (id, user_id) ON DELETE CASCADE;

-- 8. RPCs ------------------------------------------------------------------

-- A client mints a code. Any earlier code of theirs is cancelled first, so
-- there is at most one live code per client and re-tapping "Invite a coach"
-- never leaves an old one redeemable. The per-client lock makes that hold for
-- two taps at once (phone and laptop): without it each call's delete misses
-- the other's uncommitted insert and both codes stay live. (Not a unique
-- index on client_id: its violation would be caught by the retry below.)
CREATE OR REPLACE FUNCTION public.create_coach_invite()
RETURNS TABLE (invite_code text, invite_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  i integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('coach_invite:' || v_uid::text, 0));
  DELETE FROM coach_invites WHERE client_id = v_uid;
  LOOP
    -- 256 is a multiple of 32, so byte % 32 is uniform over the alphabet.
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    FOR i IN 0..9 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO coach_invites (code, client_id)
      VALUES (v_code, v_uid)
      RETURNING code, expires_at INTO invite_code, invite_expires_at;
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Another client holds this code; draw again.
    END;
  END LOOP;
END;
$$;

-- Whoever redeems a live code becomes that client's coach. The code is
-- normalised (case, spaces, the dash the app displays) before lookup.
--
-- The coach must have a name first. The client sees it in their coach list
-- and in every activity entry, and it is how they know who holds the keys to
-- their account — but sign-up seeds display_name with the email address, so
-- an account that never set one would show its email instead. A missing name,
-- or one that could be an address (it contains '@'), is refused before the
-- link is made; the app asks for the name on the same screen.
CREATE OR REPLACE FUNCTION public.redeem_coach_invite(p_code text)
RETURNS TABLE (client_id uuid, client_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invite public.coach_invites%ROWTYPE;
  v_link_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_invite FROM public.coach_invites ci WHERE ci.code = v_code FOR UPDATE;
  IF NOT FOUND OR v_invite.redeemed_at IS NOT NULL OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'That code is invalid or has expired.' USING ERRCODE = 'P0002';
  END IF;
  IF v_invite.client_id = v_uid THEN
    RAISE EXCEPTION 'That is your own invite code.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = v_uid
       AND btrim(coalesce(p.display_name, '')) <> ''
       AND position('@' in p.display_name) = 0
  ) THEN
    RAISE EXCEPTION 'Add your name first. It''s what your client will see.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.coach_links (coach_id, client_id)
  VALUES (v_uid, v_invite.client_id)
  ON CONFLICT ON CONSTRAINT coach_links_pair_unique DO NOTHING
  RETURNING id INTO v_link_id;

  UPDATE public.coach_invites ci
     SET redeemed_at = now(), redeemed_by = v_uid
   WHERE ci.code = v_code;

  IF v_link_id IS NOT NULL THEN
    INSERT INTO public.coach_activity (client_id, coach_id, coach_name, table_name, action)
    VALUES (
      v_invite.client_id,
      v_uid,
      (SELECT left(p.display_name, 80) FROM public.profiles p WHERE p.user_id = v_uid),
      'coach_links',
      'linked'
    );
  END IF;

  RETURN QUERY
    SELECT v_invite.client_id,
           (SELECT left(p.display_name, 80) FROM public.profiles p WHERE p.user_id = v_invite.client_id);
END;
$$;

-- Names for both sides of a link. SECURITY DEFINER because a client cannot
-- read their coach's profile (and should not be able to read anything else
-- of theirs); only the display name crosses over.
CREATE OR REPLACE FUNCTION public.list_my_clients()
RETURNS TABLE (link_id uuid, client_id uuid, display_name text, linked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cl.id, cl.client_id, left(p.display_name, 80), cl.created_at
    FROM public.coach_links cl
    LEFT JOIN public.profiles p ON p.user_id = cl.client_id
   WHERE cl.coach_id = auth.uid()
   ORDER BY lower(coalesce(p.display_name, '')), cl.created_at;
$$;

CREATE OR REPLACE FUNCTION public.list_my_coaches()
RETURNS TABLE (link_id uuid, coach_id uuid, display_name text, linked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cl.id, cl.coach_id, left(p.display_name, 80), cl.created_at
    FROM public.coach_links cl
    LEFT JOIN public.profiles p ON p.user_id = cl.coach_id
   WHERE cl.client_id = auth.uid()
   ORDER BY cl.created_at;
$$;

REVOKE ALL ON FUNCTION public.create_coach_invite() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_coach_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_clients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_coaches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_coach_invite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coach_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_clients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_coaches() TO authenticated;

-- 9. Shifting a client's program -------------------------------------------

-- shift_program_workouts scoped both writes to user_id = auth.uid(), which a
-- coach acting on a client's program can never satisfy. It now takes the
-- owner from the program row itself — a row the caller can only reach if it
-- is theirs or their client's, since the function still runs as the caller
-- under RLS — and moves that owner's calendar. Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.shift_program_workouts(
  p_program_id uuid,
  p_from_date text,
  p_days integer,
  p_start_date text,
  p_program_days jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_moved integer;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 366 THEN
    RAISE EXCEPTION 'days must be between 1 and 366' USING ERRCODE = '22023';
  END IF;
  IF p_from_date IS NULL OR p_from_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'from_date must be YYYY-MM-DD' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NOT NULL AND p_start_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'start_date must be YYYY-MM-DD' USING ERRCODE = '22023';
  END IF;
  IF p_program_days IS NULL OR jsonb_typeof(p_program_days) <> 'array' THEN
    RAISE EXCEPTION 'program_days must be a JSON array' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workout_programs
     SET start_date = p_start_date,
         days = p_program_days
   WHERE id = p_program_id
     AND (user_id = auth.uid()
          OR user_id IN (SELECT cl.client_id FROM public.coach_links cl WHERE cl.coach_id = auth.uid()))
  RETURNING user_id INTO v_owner;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'program not found' USING ERRCODE = 'P0002';
  END IF;

  -- Completed rows are the record of what happened on that date; they stay.
  -- Dates are YYYY-MM-DD text, which orders as a date, so the comparison is
  -- textual on purpose. A row whose date is not a real YYYY-MM-DD date (the
  -- column is unconstrained text, and a restored backup is written verbatim)
  -- is left where it is rather than failing the whole shift: the shape check
  -- keeps the textual comparison honest, and pg_input_is_valid is a real
  -- parse, so an impossible date such as 2026-02-30 is skipped rather than
  -- raising from the cast.
  UPDATE public.future_workouts AS fw
     SET date = to_char(fw.date::date + p_days, 'YYYY-MM-DD')
   WHERE fw.program_id = p_program_id
     AND fw.user_id = v_owner
     AND fw.date >= p_from_date
     AND COALESCE(fw.completed, false) = false
     AND fw.date ~ '^\d{4}-\d{2}-\d{2}$'
     AND pg_input_is_valid(fw.date, 'date');
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.shift_program_workouts(uuid, text, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shift_program_workouts(uuid, text, integer, text, jsonb) TO authenticated;
