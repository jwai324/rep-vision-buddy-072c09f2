-- Audit 13.3 — a program's scheduled rows had nothing tying them to the program.
--
-- future_workouts.program_id names the workout_programs row a scheduled day
-- belongs to, and until now the database did not know that. Nothing stopped a
-- row from naming a program that had been deleted, and nothing removed a
-- program's rows when the program went: `deleteProgram` in
-- src/hooks/useStorage.ts deletes the calendar rows itself, in a second
-- statement, and that application-level cascade is the only thing keeping the
-- two in step. It is correct today, but it is one forgotten call site — an
-- edge function, a dashboard delete, a future rewrite — away from leaving a
-- user with scheduled workouts belonging to a program that does not exist.
-- Those rows are invisible to the app (every reader filters futureWorkouts on
-- `programId === activeProgramId || programId === 'manual'`), so they would
-- accumulate silently.
--
-- This adds the key and lets Postgres do the cascade.
--
-- THE 'manual' MARKER — why it does not block this. The client uses the string
-- 'manual' as a program id for rows that exist only in memory: a rest day
-- added from the dashboard or the monthly calendar, and the synthetic detail
-- screens minted in src/pages/Index.tsx and src/hooks/useScreenHelpers.ts. If
-- such a row could be stored, this foreign key would reject it. It cannot be,
-- for two independent reasons, both checked against the live database rather
-- than assumed:
--
--   1. The column is `program_id uuid NOT NULL`. 'manual' is not a uuid, so
--      Postgres rejects the write with 22P02 (invalid input syntax for type
--      uuid) before any constraint is consulted. The type has been the gate all
--      along; this key adds no new failure mode for it.
--   2. The client never tries. The only write path is `updateFutureWorkout`
--      (src/hooks/useStorage.ts), reachable from one call site
--      (src/pages/Index.tsx), which is gated on
--      `canPersist = hasValidProgramId && !isManual` — a uuid-shaped id that is
--      not the literal 'manual'. `deleteFutureWorkout` is gated the same way.
--
--   Confirmed in the data too: all 294 stored rows reference one of the 6 real
--   programs, and none has a program_id of 'manual' (as it must not, for a
--   uuid column).
--
-- ORPHANS. Counted on the live database immediately before writing this file:
-- zero of the 294 rows reference a program that does not exist, so the sweep
-- below is expected to DELETE NOTHING. It is kept rather than removed so this
-- migration is also correct against a database that has drifted since (a
-- branch, a restored backup, a staging copy), and the RAISE NOTICE records
-- what it actually removed. Any row it does delete is a scheduled workout for
-- a program that no longer exists — already unreachable from every screen in
-- the app, for the filtering reason above.
--
-- IRREVERSIBLE IN EFFECT — read this before applying. The constraint can be
-- dropped again, but from now on deleting a workout_programs row permanently
-- deletes that program's scheduled calendar in the same statement, including
-- rows the user hand-edited: shifted dates, recovery activities, and completed
-- days that are part of their record. The app already does exactly this in
-- `deleteProgram`, so no behaviour visible to a user changes today; what
-- changes is that it now also happens for any deletion that does not go
-- through the app.
--
-- This migration is independent of the auth.users cascade migration in this
-- same batch — either can be applied, or held back, without the other. Applied
-- together, a deleted account reaches future_workouts by two paths (directly
-- through its own user_id key, and indirectly through workout_programs);
-- Postgres deletes each row once and multi-path cascades are not a conflict.
--
-- Re-runnable: the sweep is idempotent, and the constraint is added only if a
-- constraint of that name is not already present.
--
-- Locking: ADD CONSTRAINT takes a brief ACCESS EXCLUSIVE lock on
-- future_workouts and a SHARE ROW EXCLUSIVE on workout_programs while it
-- validates. 294 rows against 6 — milliseconds. No index is created here: a
-- sibling migration in this batch already adds
-- future_workouts_user_program_date_idx, and at this size the cascade's lookup
-- is a trivial scan either way.

DO $$
DECLARE
  removed bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'future_workouts'
      AND c.conname = 'future_workouts_program_id_fkey'
  ) THEN
    RAISE NOTICE 'future_workouts_program_id_fkey already exists, leaving it alone';
    RETURN;
  END IF;

  -- Delete the scheduled rows whose program no longer exists. Expected to
  -- remove 0 rows on this project.
  DELETE FROM public.future_workouts f
   WHERE NOT EXISTS (
     SELECT 1 FROM public.workout_programs p WHERE p.id = f.program_id
   );
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'future_workouts: deleted % scheduled row(s) whose program no longer exists', removed;
  END IF;

  ALTER TABLE public.future_workouts
    ADD CONSTRAINT future_workouts_program_id_fkey FOREIGN KEY (program_id)
    REFERENCES public.workout_programs(id) ON DELETE CASCADE;
  RAISE NOTICE 'future_workouts: added future_workouts_program_id_fkey (ON DELETE CASCADE)';
END $$;
