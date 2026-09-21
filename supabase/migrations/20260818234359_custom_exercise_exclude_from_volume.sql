-- Lets a user keep an exercise (rehab, mobility, wrist/ankle iso work) in
-- their library and their logs while keeping it out of volume and set totals.
ALTER TABLE public.custom_exercises
ADD COLUMN exclude_from_volume boolean NOT NULL DEFAULT false;
