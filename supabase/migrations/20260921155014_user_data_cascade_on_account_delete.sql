-- Audit 13.1 — deleting an account left most of its data behind.
--
-- Deleting a user from the Supabase dashboard removes the row in auth.users.
-- Everything in public that carries a user_id and has a foreign key to
-- auth.users goes with it; everything that does not simply stays, forever,
-- pointing at a user id that no longer resolves. Seven tables had the key and
-- nine did not, so "delete this account" took the login, the profile, the
-- shares, the body measurements, the purchases and the credit rows, and left
-- behind every workout, template, program, scheduled day, setting and usage
-- row the account had ever written.
--
--   ALREADY had user_id -> auth.users(id) ON DELETE CASCADE:
--     body_measurements, error_reports, iap_purchases, profiles, shares,
--     token_ledger, user_token_balance
--
--   MISSING it, and added here (all nine):
--     ai_error_log, custom_exercises, future_workouts, user_ai_usage,
--     user_settings, workout_programs, workout_sessions, workout_templates,
--     workout_templates_superset_backup
--
--   Has no user_id at all and is deliberately untouched:
--     exercise_clips — the global clip map, keyed by exercise id, owned by
--     nobody.
--
-- IRREVERSIBLE IN EFFECT — read this before applying. The constraints
-- themselves can be dropped again, but their whole point is that a future
-- account deletion now destroys data that previously survived it. After this
-- migration, removing a user from the dashboard (or via auth.admin.deleteUser
-- with a hard delete) permanently deletes that user's workout history,
-- templates, programs, scheduled calendar, custom exercises, settings and AI
-- usage rows, in the same statement, with no undo and no prompt. That is the
-- intent of the audit item. It also means an accidental dashboard deletion is
-- no longer recoverable by re-creating the login. A soft delete (auth's
-- deleted_at) does NOT cascade — only a real DELETE from auth.users does.
--
-- Two of the nine deserve a second look, because "the user's data" is arguable:
--
--   ai_error_log is operational telemetry. Nothing in the app, the edge
--   functions or the triage routine ever reads it back; the two edge functions
--   only insert. Its rows do carry a user's error text, so CASCADE is the
--   consistent choice, but if you would rather keep the log and drop only the
--   attribution, change this one to ON DELETE SET NULL — the column is already
--   nullable, so that works with no other change.
--
--   workout_templates_superset_backup is an out-of-band snapshot of template
--   exercises (8 rows, no primary key, created outside the migration files)
--   taken as a recovery net for the superset rework. CASCADE means deleting an
--   account also destroys its recovery copy. That is correct if the account is
--   really gone, and wrong if the deletion was the mistake you wanted the
--   backup for. Drop this one table from the list below to hold it back.
--
-- ORPHANS. A foreign key cannot be added while a row violates it, so each
-- table is swept first. Counted on the live database immediately before
-- writing this file, every table had zero orphaned and zero null user_ids, so
-- the sweep is expected to DELETE NOTHING. It is kept anyway rather than
-- removed: it is what makes this migration safe to run against a database that
-- has drifted since (a branch, a restored backup, a staging copy), and the
-- RAISE NOTICE prints what it actually removed so the apply log records it
-- either way. If it ever does delete rows, those rows are exactly the ones
-- whose owning account is already gone — data that is unreachable by any user,
-- any RLS policy and any screen in the app.
--
-- Re-runnable: the sweep is idempotent by nature, and each constraint is added
-- only if a constraint of that name is not already present, so a second apply
-- is a no-op rather than a duplicate-object error.
--
-- Locking: ADD CONSTRAINT takes a brief ACCESS EXCLUSIVE lock on the child
-- table and a SHARE ROW EXCLUSIVE on auth.users while it validates. At this
-- project's size (the largest table is future_workouts at 294 rows) that is
-- milliseconds. The NOT VALID / VALIDATE CONSTRAINT two-step exists for tables
-- big enough that the validation scan matters; nothing here is close.

DO $$
DECLARE
  -- The nine tables this migration adds the key to. Edit this list to hold one
  -- back; nothing below is hard-coded to a particular table.
  target text;
  targets constant text[] := ARRAY[
    'ai_error_log',
    'custom_exercises',
    'future_workouts',
    'user_ai_usage',
    'user_settings',
    'workout_programs',
    'workout_sessions',
    'workout_templates',
    'workout_templates_superset_backup'
  ];
  fk_name text;
  removed bigint;
BEGIN
  FOREACH target IN ARRAY targets LOOP
    fk_name := target || '_user_id_fkey';

    -- Refuse to guess. If the table or its user_id column is not there, say so
    -- and stop, rather than silently skipping a table the audit expects to be
    -- covered.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target AND column_name = 'user_id'
    ) THEN
      RAISE EXCEPTION 'public.% has no user_id column; the table list in this migration is out of date', target;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public' AND rel.relname = target AND c.conname = fk_name
    ) THEN
      RAISE NOTICE '%: % already exists, leaving it alone', target, fk_name;
      CONTINUE;
    END IF;

    -- Delete the rows whose owning account no longer exists. Nothing else is
    -- touched: a NULL user_id is left as it is (it violates nothing), and a row
    -- whose user_id still resolves is never considered. Expected to remove 0
    -- rows on this project.
    EXECUTE format(
      'DELETE FROM public.%I x
        WHERE x.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)',
      target
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    IF removed > 0 THEN
      RAISE NOTICE '%: deleted % orphaned row(s) whose owning account no longer exists', target, removed;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I
         ADD CONSTRAINT %I FOREIGN KEY (user_id)
         REFERENCES auth.users(id) ON DELETE CASCADE',
      target, fk_name
    );
    RAISE NOTICE '%: added % (ON DELETE CASCADE)', target, fk_name;
  END LOOP;
END $$;
