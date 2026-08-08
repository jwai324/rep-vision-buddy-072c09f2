-- Coach profile: support "hybrid athlete" (multi-goal) and a free-text notes
-- field the AI coach reads on every turn.
--
-- goal gains a 'hybrid' option. hybrid_goals is the array of sub-goals the
-- user wants blended when goal='hybrid'; ignored otherwise. coach_notes is
-- free text (bounded so an overrun user prompt can't blow up cache tokens).

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_goal_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_goal_check
    CHECK (goal IS NULL OR goal IN ('hypertrophy','strength','fat_loss','endurance','general','hybrid'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hybrid_goals TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS coach_notes TEXT;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_hybrid_goals_check
    CHECK (
      hybrid_goals <@ ARRAY['hypertrophy','strength','fat_loss','endurance','general']::TEXT[]
      AND (array_length(hybrid_goals, 1) IS NULL OR array_length(hybrid_goals, 1) <= 5)
    );

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_coach_notes_length_check
    CHECK (coach_notes IS NULL OR char_length(coach_notes) <= 2000);
