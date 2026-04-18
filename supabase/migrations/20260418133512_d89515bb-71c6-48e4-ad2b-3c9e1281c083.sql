ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS streak_mode text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS streak_weekly_target integer NOT NULL DEFAULT 3;