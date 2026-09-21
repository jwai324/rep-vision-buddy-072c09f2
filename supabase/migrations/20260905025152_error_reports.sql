-- In-app "report a problem" queue.
--
-- Rows are written by the report sheet (src/components/ErrorReportButton.tsx)
-- and worked by the scheduled error-triage routine
-- (.claude/skills/error-triage/SKILL.md). The routine deletes a row once its
-- fix is on main and verified; anything it will not fix on its own stays in
-- the table as needs_review with a note, and is surfaced in the daily brief.
-- The table is therefore a queue, not a log — the audit trail of what was
-- fixed lives in git history and the Notion "RepVision Error Reports" page.

CREATE TABLE public.error_reports (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('bug', 'correction', 'idea')),
  description   text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  expected      text CHECK (expected IS NULL OR char_length(expected) <= 1000),
  -- Captured by the client at submit time, never typed by the user.
  screen        text,
  route         text,
  app_version   text,
  user_agent    text,
  viewport      text,
  -- Everything else the client attaches: recent console errors, online
  -- state, timezone, display mode. Free-form so the client can add fields
  -- without a migration.
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- new          → untouched, the routine will pick it up
  -- fixing       → a routine run has claimed it (guards against a second
  --                overlapping run working the same row)
  -- needs_review → the routine decided it is not an obvious fix; see
  --                triage_notes for why and what decision is needed
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'fixing', 'needs_review')),
  triage_notes  text,
  triaged_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX error_reports_status_created_idx ON public.error_reports (status, created_at);
CREATE INDEX error_reports_user_created_idx ON public.error_reports (user_id, created_at DESC);

ALTER TABLE public.error_reports ENABLE ROW LEVEL SECURITY;

-- A user can file reports and see their own. There is deliberately no user
-- UPDATE or DELETE policy: status, triage_notes and deletion belong to the
-- triage routine, which runs with the service role and bypasses RLS.
CREATE POLICY "Users can insert their own error reports"
ON public.error_reports FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own error reports"
ON public.error_reports FOR SELECT
USING (auth.uid() = user_id);

CREATE TRIGGER update_error_reports_updated_at
BEFORE UPDATE ON public.error_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
