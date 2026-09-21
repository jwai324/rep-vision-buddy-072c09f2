-- Streak adjustment offset: preserves the streak value the user was seeing
-- at the moment they change streak_mode or streak_weekly_target so the
-- home-screen indicator doesn't visibly change from a settings edit.
--
-- streak_adjustment is added to the raw streak computation before display.
-- streak_adjustment_set_at is the day the current adjustment was locked in;
-- used to detect a natural break under the NEW mode (raw = 0 after at least
-- one period has elapsed) so the client can clear the adjustment.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS streak_adjustment INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_adjustment_set_at DATE;
