-- Profile fields used by the AI coach: goal, experience level, equipment,
-- injuries to avoid, plus demographics (age, sex, height). Plus a separate
-- body_measurements table for bodyweight time-series.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS goal TEXT,
  ADD COLUMN IF NOT EXISTS experience_level TEXT,
  ADD COLUMN IF NOT EXISTS equipment TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS injuries TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS sex TEXT,
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_goal_check
    CHECK (goal IS NULL OR goal IN ('hypertrophy','strength','fat_loss','endurance','general'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_experience_level_check
    CHECK (experience_level IS NULL OR experience_level IN ('beginner','intermediate','advanced'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_sex_check
    CHECK (sex IS NULL OR sex IN ('male','female','other','prefer_not_to_say'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_age_check
    CHECK (age IS NULL OR (age >= 13 AND age <= 120));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_height_cm_check
    CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm < 300));

-- Bodyweight time-series. weight stored canonical in kg; UI converts.
CREATE TABLE IF NOT EXISTS public.body_measurements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight_kg NUMERIC NOT NULL CHECK (weight_kg > 0 AND weight_kg < 500),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS body_measurements_user_date_idx
  ON public.body_measurements(user_id, date DESC);

ALTER TABLE public.body_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own body measurements"
ON public.body_measurements FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own body measurements"
ON public.body_measurements FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own body measurements"
ON public.body_measurements FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own body measurements"
ON public.body_measurements FOR DELETE
USING (auth.uid() = user_id);
