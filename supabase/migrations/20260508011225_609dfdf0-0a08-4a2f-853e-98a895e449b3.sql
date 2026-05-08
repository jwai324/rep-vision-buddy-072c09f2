ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS custom_locations jsonb NOT NULL DEFAULT '["Home Gym"]'::jsonb;