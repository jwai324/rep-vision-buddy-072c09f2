-- Makes the AI pre-call credit gate atomic, and closes the PUBLIC half of the
-- function-privilege lockdown that 20260915170641 left open.

-- ---------------------------------------------------------------------------
-- 1. The gate was check-then-act: ai-coach read the balance, made a model call
--    that runs for 10-30 seconds, and only then debited through the row-locked
--    consume_tokens RPC. The debit was atomic; the CHECK was not. N concurrent
--    requests therefore all read the same untouched balance, all passed, and
--    all ran — so a five-cent reserve could authorise an unbounded amount of
--    real Anthropic spend. The "bounded ~1-turn overshoot" the old comment
--    claimed only held for strictly sequential requests.
--
--    begin_ai_turn takes the same row lock the debit takes and counts turns
--    that are in flight but not yet settled, so the Nth concurrent request is
--    refused unless the balance could cover all N reserves.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_token_balance
  ADD COLUMN IF NOT EXISTS in_flight    integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS in_flight_at timestamptz;

COMMENT ON COLUMN public.user_token_balance.in_flight IS
  'AI turns started but not yet settled. Held only between begin_ai_turn and end_ai_turn.';

CREATE OR REPLACE FUNCTION public.begin_ai_turn(
  p_user_id        uuid,
  p_reserve_micros bigint,
  p_max_concurrent integer DEFAULT 3
)
RETURNS TABLE (
  allowed          boolean,
  available_micros bigint,
  in_flight        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free_cap   bigint;
  v_period     text := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');
  v_row        public.user_token_balance%ROWTYPE;
  v_in_flight  integer;
  v_available  bigint;
  v_allowed    boolean;
BEGIN
  -- Same tier-based cap as consume_tokens. Kept in step with
  -- monthlyAllowanceMicros() in _shared/pricing.ts and src/utils/credits.ts.
  SELECT CASE WHEN p.subscription_tier = 'premium' THEN 7000000 ELSE 500000 END
    INTO v_free_cap
    FROM public.profiles p
    WHERE p.user_id = p_user_id;
  IF v_free_cap IS NULL THEN
    v_free_cap := 500000;
  END IF;

  INSERT INTO public.user_token_balance (user_id, free_period)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.user_token_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_row.free_period <> v_period THEN
    v_row.free_used_micros := 0;
    v_row.free_period := v_period;
  END IF;

  -- A crashed or reclaimed isolate never reaches end_ai_turn, so a held slot
  -- has to be able to expire. No AI turn runs for five minutes.
  v_in_flight := v_row.in_flight;
  IF v_row.in_flight_at IS NULL OR v_row.in_flight_at < now() - interval '5 minutes' THEN
    v_in_flight := 0;
  END IF;

  v_available := GREATEST(0, v_free_cap - v_row.free_used_micros) + v_row.paid_balance_micros;

  -- Every turn already running still has to be payable, so the reserve is
  -- counted once per in-flight turn plus this one.
  v_allowed := v_in_flight < p_max_concurrent
               AND v_available >= p_reserve_micros * (v_in_flight + 1);

  IF v_allowed THEN
    UPDATE public.user_token_balance
    SET in_flight       = v_in_flight + 1,
        in_flight_at    = now(),
        free_used_micros = v_row.free_used_micros,
        free_period      = v_row.free_period,
        updated_at       = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.user_token_balance
    SET in_flight        = v_in_flight,
        free_used_micros = v_row.free_used_micros,
        free_period      = v_row.free_period
    WHERE user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_allowed, v_available, v_in_flight + (CASE WHEN v_allowed THEN 1 ELSE 0 END);
END;
$$;

-- Releases the slot. Safe to call more than once and safe to miss entirely —
-- the staleness window above is the backstop.
CREATE OR REPLACE FUNCTION public.end_ai_turn(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_token_balance
  SET in_flight = GREATEST(0, in_flight - 1)
  WHERE user_id = p_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Function privileges. 20260915170641 revoked the anon/authenticated default
--    grants but left PostgreSQL's built-in PUBLIC EXECUTE default in place, so
--    a SECURITY DEFINER function added by a future migration would still be
--    reachable from a client — the exact bug that one was fixing. Both halves
--    are needed, and FOR ROLE is explicit because default privileges attach to
--    the role that creates the object, and migrations here are applied by
--    postgres both through the CLI and through the MCP server.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.begin_ai_turn(uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_ai_turn(uuid)                    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.begin_ai_turn(uuid, bigint, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.end_ai_turn(uuid)                    TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- get_shared_item is the one function clients are meant to call: it is the sole
-- public read path for /s/:token. Re-asserted here so the default-privilege
-- change above cannot leave the share page silently 404-ing for logged-out
-- viewers. Any future migration that DROPs and re-CREATEs it (rather than using
-- CREATE OR REPLACE) must re-issue this grant.
GRANT EXECUTE ON FUNCTION public.get_shared_item(text) TO anon, authenticated;
