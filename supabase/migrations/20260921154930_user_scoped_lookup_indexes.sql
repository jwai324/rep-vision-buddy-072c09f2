-- Lookup indexes for the user-scoped tables (audit 13.2).
--
-- Every client query and every RLS policy on these tables filters on user_id,
-- and until now only their primary key was indexed. Postgres therefore answers
-- each read with a sequential scan over EVERY user's rows and sorts the result.
-- RLS makes that true of writes too: `UPDATE ... WHERE id = $1 AND user_id =
-- $2` finds its row by the primary key, but the policy's own `user_id =
-- auth.uid()` is re-checked, and any statement without an id (the calendar
-- retire, the program shift) has nothing but user_id to work from.
--
-- Each index below is a composite matching the shape of a query that actually
-- exists: the equality on user_id first, then whatever the same statement
-- orders or ranges by, so Postgres can walk the index instead of sorting the
-- table. None is added speculatively — an unused index is write cost and space
-- with nothing to show for it.
--
-- Why plain CREATE INDEX and not CONCURRENTLY: a Supabase migration runs inside
-- a transaction, and CREATE INDEX CONCURRENTLY cannot (it raises 25001). Plain
-- CREATE INDEX takes a SHARE lock that blocks writes to the table while the
-- index builds; at this project's size — the largest of these tables is
-- future_workouts at 294 rows / 152 kB, and workout_sessions is 127 rows — that
-- build is a fraction of a millisecond, so there is nothing to work around.
-- Revisit that only once one of these tables is large enough for a build to
-- block writers for a noticeable time: think hundreds of thousands of rows /
-- hundreds of MB, where the build runs into seconds. At that point the index
-- goes in outside the migration runner, in an autocommit session, as CREATE
-- INDEX CONCURRENTLY, and is checked afterwards with `SELECT indisvalid FROM
-- pg_index` — a failed concurrent build leaves an invalid index behind that
-- still costs writes and answers nothing.
--
-- IF NOT EXISTS throughout, so the migration is safe to re-run.

-- The app's session history: `useStorage`'s load reads
--   .from('workout_sessions').eq('user_id', userId)
--     .order('date', { ascending: false }).range(0, 499)
-- (src/hooks/useStorage.ts, the load effect). `date` is YYYY-MM-DD text, which
-- sorts chronologically, so the index ordering is the query's ordering and the
-- 500-row cap is answered by reading the first 500 index entries rather than
-- sorting the user's whole history.
CREATE INDEX IF NOT EXISTS workout_sessions_user_date_idx
  ON public.workout_sessions (user_id, date DESC);

-- Templates load newest-first:
--   .from('workout_templates').eq('user_id', userId)
--     .order('created_at', { ascending: false }).range(0, 4999)
-- (src/hooks/useStorage.ts, the load effect). The user_id prefix also serves
-- the rollback in `removeImportedTemplates`
-- (src/utils/shareImport.ts), which deletes .eq('user_id').in('id', ids).
CREATE INDEX IF NOT EXISTS workout_templates_user_created_idx
  ON public.workout_templates (user_id, created_at DESC);

-- Programs load the same way:
--   .from('workout_programs').eq('user_id', userId)
--     .order('created_at', { ascending: false })
-- (src/hooks/useStorage.ts, the load effect).
CREATE INDEX IF NOT EXISTS workout_programs_user_created_idx
  ON public.workout_programs (user_id, created_at DESC);

-- The schedule read, which is paged:
--   .from('future_workouts').eq('user_id', userId)
--     .order('date').order('id').range(from, to)
-- (`fetchAllPages('schedule', ...)` in src/hooks/useStorage.ts). Without the
-- index every page re-scans and re-sorts the whole table to reach its offset.
-- The three columns are exactly the read's total order — id is the tiebreak
-- that keeps two pages from disagreeing about rows sharing a date.
CREATE INDEX IF NOT EXISTS future_workouts_user_date_id_idx
  ON public.future_workouts (user_id, date, id);

-- The calendar's per-program statements, none of which has a row id to work
-- from — all three filter on program_id within the user, two with a date range:
--   * saveProgram's retire pass: delete .eq('program_id').eq('user_id')
--     .gte('date', today).or('completed.is.null,completed.eq.false')
--   * deleteProgram: delete .eq('program_id').eq('user_id')
--     (both src/hooks/useStorage.ts)
--   * shift_program_workouts (20260919141335_atomic_program_shift.sql), whose
--     UPDATE is `program_id = $1 AND user_id = auth.uid() AND date >= $2 AND
--     COALESCE(completed,false) = false`.
-- The date-ordered index above cannot serve these: its rows are ordered by date
-- across all of the user's programs, so a user running a second plan pays a
-- scan of the other plan's rows on every program save. Equality, equality,
-- range is the column order those three statements want. `completed` is
-- deliberately not a key column: `IS NULL OR = false` is not an equality the
-- index can seek on, and a partial index for it would be fitted to one caller.
CREATE INDEX IF NOT EXISTS future_workouts_user_program_date_idx
  ON public.future_workouts (user_id, program_id, date);

-- Custom exercises. The list read is the one query here that carries no
-- explicit user filter at all —
--   .from('custom_exercises').select('*').order('created_at', { ascending: false })
-- in `fetchExercises` (src/hooks/useCustomExercises.ts) — so the only thing
-- narrowing it is the RLS policy's own `auth.uid() = user_id`. That makes this
-- the clearest case of the audit's point: without the index the policy is
-- applied by scanning every user's exercises. The user_id prefix also serves
-- `reconcileCustomExercises` (src/utils/shareImport.ts), which reads
-- .select('id, name').eq('user_id', userId) on every share import.
CREATE INDEX IF NOT EXISTS custom_exercises_user_created_idx
  ON public.custom_exercises (user_id, created_at DESC);

-- ai_error_log is deliberately left without one. It is insert-only: the two
-- edge functions write to it (supabase/functions/ai-coach/index.ts and
-- generate-program/index.ts) and nothing in the app, the edge functions, or the
-- triage routine ever selects from it — the "Users can view own errors" policy
-- has no query behind it. An index there would add write cost to the error path
-- and answer nothing. Add `ai_error_log (user_id, created_at DESC)` the day
-- something actually reads a user's AI errors back.
