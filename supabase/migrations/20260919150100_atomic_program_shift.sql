-- Shifting a program's calendar used to be one UPDATE per row, fired in
-- parallel from the client. A failure part-way left some rows moved and some
-- not, with the screen showing none moved and the program's own start dates
-- untouched. This moves every row and the program's dates in one
-- transaction, so either all of it lands or none of it does.
--
-- SECURITY INVOKER: the updates run as the caller under the tables' RLS,
-- which is what scopes them to the caller's own rows. The program's new
-- start_date and days come from the client, which already holds the
-- frequency logic that decides which anchors move (only every-N-days anchors
-- shift); this function guarantees only that the two writes are atomic.
CREATE OR REPLACE FUNCTION public.shift_program_workouts(
  p_program_id uuid,
  p_from_date text,
  p_days integer,
  p_start_date text,
  p_program_days jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_moved integer;
  v_program integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 366 THEN
    RAISE EXCEPTION 'days must be between 1 and 366' USING ERRCODE = '22023';
  END IF;
  IF p_from_date IS NULL OR p_from_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'from_date must be YYYY-MM-DD' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NOT NULL AND p_start_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'start_date must be YYYY-MM-DD' USING ERRCODE = '22023';
  END IF;
  IF p_program_days IS NULL OR jsonb_typeof(p_program_days) <> 'array' THEN
    RAISE EXCEPTION 'program_days must be a JSON array' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workout_programs
     SET start_date = p_start_date,
         days = p_program_days
   WHERE id = p_program_id
     AND user_id = auth.uid();
  GET DIAGNOSTICS v_program = ROW_COUNT;
  IF v_program = 0 THEN
    RAISE EXCEPTION 'program not found' USING ERRCODE = 'P0002';
  END IF;

  -- Completed rows are the record of what happened on that date; they stay.
  -- Dates are YYYY-MM-DD text, which orders as a date, so the comparison is
  -- textual on purpose. A row whose date does not parse is left where it is
  -- rather than failing the whole shift.
  UPDATE public.future_workouts AS fw
     SET date = to_char(fw.date::date + p_days, 'YYYY-MM-DD')
   WHERE fw.program_id = p_program_id
     AND fw.user_id = auth.uid()
     AND fw.date >= p_from_date
     AND COALESCE(fw.completed, false) = false
     AND fw.date ~ '^\d{4}-\d{2}-\d{2}$';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.shift_program_workouts(uuid, text, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shift_program_workouts(uuid, text, integer, text, jsonb) TO authenticated;
