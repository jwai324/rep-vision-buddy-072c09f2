
CREATE TABLE public.custom_exercises (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  primary_body_part text NOT NULL DEFAULT 'Full Body',
  equipment text NOT NULL DEFAULT 'None',
  difficulty text NOT NULL DEFAULT 'Intermediate',
  exercise_type text NOT NULL DEFAULT 'Isolation',
  movement_pattern text NOT NULL DEFAULT 'Other',
  secondary_muscles jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_recovery boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own custom exercises"
  ON public.custom_exercises FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own custom exercises"
  ON public.custom_exercises FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own custom exercises"
  ON public.custom_exercises FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own custom exercises"
  ON public.custom_exercises FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_custom_exercises_updated_at
  BEFORE UPDATE ON public.custom_exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
