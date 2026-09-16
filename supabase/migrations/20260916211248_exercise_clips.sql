-- Exercise demonstration clips: one row per exercise, media in Storage.
--
-- exercise_id is the app-side id (an EXERCISE_DATABASE id such as 'air-squat',
-- or 'custom-<uuid>' for a custom exercise). It is deliberately not a foreign
-- key: the built-in library ships in the JS bundle, not in a table. The ingest
-- script (scripts/clips/ingest.ts) refuses to write an id it cannot resolve.
CREATE TABLE public.exercise_clips (
  exercise_id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  webm_path text NOT NULL,
  mp4_path text NOT NULL,
  poster_path text NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms > 0),
  -- Encoded pixel size. The client reserves the box from these before the
  -- media loads, so the detail screen never reflows.
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  source_bg text NOT NULL CHECK (source_bg IN ('white', 'green')),
  -- Vendor filename, for provenance and so a second file that resolves to the
  -- same exercise is flagged for review instead of silently replacing this one.
  source_file text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_exercise_clips_updated_at
  BEFORE UPDATE ON public.exercise_clips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.exercise_clips ENABLE ROW LEVEL SECURITY;

-- Reference data: any signed-in user may read. There is no INSERT, UPDATE or
-- DELETE policy on purpose; the ingest script writes with the service role.
-- Not granted to anon: the table is the only map of object paths, and the
-- vendor licence does not allow the library to be enumerable logged out.
CREATE POLICY "Signed-in users can read exercise clips"
  ON public.exercise_clips FOR SELECT
  TO authenticated
  USING (true);

-- Public-read bucket with NO storage.objects policy for it. A public bucket
-- serves objects by exact path through /storage/v1/object/public/... without
-- consulting RLS, while list and search go through RLS and find nothing, so
-- the bucket is readable but not enumerable. Object names carry a content
-- hash (see the ingest script), so paths are not guessable from an exercise
-- name either. Uploads use the service role, which bypasses RLS.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exercise-clips',
  'exercise-clips',
  true,
  10485760,
  ARRAY['video/webm', 'video/mp4', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
