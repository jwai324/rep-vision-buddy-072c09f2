-- Follow-ups to 20260915182136_atomic_ai_turn_gate, from an adversarial review
-- of that change.

-- ---------------------------------------------------------------------------
-- 1. The in-flight slot could be held forever.
--
--    begin_ai_turn stamped in_flight_at = now() on every allowed turn and
--    end_ai_turn never cleared it, so the five-minute staleness reclaim keyed
--    off the MOST RECENT turn rather than the oldest unreleased one. A slot
--    leaked by an edge function that threw before releasing was therefore kept
--    alive by the user's own next message: each turn inside five minutes pushed
--    the timestamp forward, the leaked slot never expired, and after three leaks
--    the user was refused their own coach until they stopped using it for five
--    full minutes.
--
--    in_flight_at now marks when the count last went 0 -> 1, and is cleared when
--    it returns to 0. The window is then measured from the oldest turn still
--    held, which is what "no AI turn runs for five minutes" was meant to mean.
--
-- 2. The caller could not tell "busy" from "out of credits".
--
--    Both arrived as allowed = false, and the functions guessed from in_flight.
--    A refusal caused by the balance while one turn was in flight was reported
--    to the user as "out of credits" — which the client latches into an
--    exhausted-balance UI — and vice versa. The reason is now returned, so
--    adding a third refusal reason later cannot silently re-break this.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.begin_ai_turn(uuid, bigint, integer);

CREATE FUNCTION public.begin_ai_turn(
  p_user_id        uuid,
  p_reserve_micros bigint,
  p_max_concurrent integer DEFAULT 3
)
RETURNS TABLE (
  allowed          boolean,
  reason           text,
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
  v_held_since timestamptz;
  v_available  bigint;
  v_allowed    boolean;
  v_reason     text;
BEGIN
  -- Same tier-based cap the live consume_tokens uses (set by
  -- 20260518052633_premium_monthly_allowance, which the repo's copy of the
  -- original token_credits migration does not reflect). Kept in step with
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
  -- has to be able to expire. Measured from the oldest turn still held.
  v_in_flight  := GREATEST(0, v_row.in_flight);
  v_held_since := v_row.in_flight_at;
  IF v_in_flight > 0 AND (v_held_since IS NULL OR v_held_since < now() - interval '5 minutes') THEN
    v_in_flight  := 0;
    v_held_since := NULL;
  END IF;

  v_available := GREATEST(0, v_free_cap - v_row.free_used_micros) + v_row.paid_balance_micros;

  IF v_in_flight >= p_max_concurrent THEN
    v_allowed := false;
    v_reason  := 'busy';
  ELSIF v_available < p_reserve_micros * (v_in_flight + 1) THEN
    -- Every turn already running still has to be payable, so the reserve is
    -- counted once per in-flight turn plus this one.
    v_allowed := false;
    v_reason  := 'insufficient_credits';
  ELSE
    v_allowed := true;
    v_reason  := 'ok';
  END IF;

  IF v_allowed THEN
    UPDATE public.user_token_balance
    SET in_flight        = v_in_flight + 1,
        in_flight_at     = COALESCE(v_held_since, now()),
        free_used_micros = v_row.free_used_micros,
        free_period      = v_row.free_period,
        updated_at       = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.user_token_balance
    SET in_flight        = v_in_flight,
        in_flight_at     = v_held_since,
        free_used_micros = v_row.free_used_micros,
        free_period      = v_row.free_period
    WHERE user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT
    v_allowed,
    v_reason,
    v_available,
    v_in_flight + (CASE WHEN v_allowed THEN 1 ELSE 0 END);
END;
$$;

CREATE OR REPLACE FUNCTION public.end_ai_turn(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_token_balance
  SET in_flight    = GREATEST(0, in_flight - 1),
      -- Cleared on the last release so the next turn re-anchors the staleness
      -- window instead of inheriting a timestamp from a turn that is over.
      in_flight_at = CASE WHEN GREATEST(0, in_flight - 1) = 0 THEN NULL ELSE in_flight_at END
  WHERE user_id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_ai_turn(uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_ai_turn(uuid)                    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.begin_ai_turn(uuid, bigint, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.end_ai_turn(uuid)                    TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Make the ledger re-priceable.
--
--    token_ledger stored only micro-dollars, so when the rates were found to be
--    3x too high on 2026-09-15 there was no way to re-price the history: the
--    token counts behind each row were gone. Recording them (and the model that
--    produced them) means the next rate change — including the documented swap
--    to claude-sonnet-4-6 — is a correctable event rather than a permanent one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.token_ledger
  ADD COLUMN IF NOT EXISTS model                 text,
  ADD COLUMN IF NOT EXISTS input_tokens          integer,
  ADD COLUMN IF NOT EXISTS output_tokens         integer,
  ADD COLUMN IF NOT EXISTS cache_write_tokens    integer,
  ADD COLUMN IF NOT EXISTS cache_read_tokens     integer;

COMMENT ON COLUMN public.token_ledger.model IS
  'Model that produced the usage this row was priced from. NULL for rows written before 2026-09-15, whose delta_micros was computed at the 3x Opus 4.1 rate and cannot be re-priced.';

DROP FUNCTION IF EXISTS public.consume_tokens(uuid, bigint, text, text);

CREATE FUNCTION public.consume_tokens(
  p_user_id           uuid,
  p_cost_micros       bigint,
  p_reason            text,
  p_reference         text,
  p_model             text    DEFAULT NULL,
  p_input_tokens      integer DEFAULT NULL,
  p_output_tokens     integer DEFAULT NULL,
  p_cache_write_tokens integer DEFAULT NULL,
  p_cache_read_tokens integer DEFAULT NULL
)
RETURNS TABLE (
  new_balance_micros  bigint,
  free_used_micros    bigint,
  paid_balance_micros bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free_cap   bigint;
  v_period     text   := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');
  v_row        public.user_token_balance%ROWTYPE;
  v_free_avail bigint;
  v_from_free  bigint;
  v_from_paid  bigint;
  v_after      bigint;
BEGIN
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

  v_free_avail := GREATEST(0, v_free_cap - v_row.free_used_micros);
  v_from_free  := LEAST(v_free_avail, p_cost_micros);
  v_from_paid  := p_cost_micros - v_from_free;

  v_row.free_used_micros    := v_row.free_used_micros + v_from_free;
  v_row.paid_balance_micros := v_row.paid_balance_micros - v_from_paid;

  v_after := GREATEST(0, v_free_cap - v_row.free_used_micros) + v_row.paid_balance_micros;

  UPDATE public.user_token_balance
  SET free_used_micros      = v_row.free_used_micros,
      free_period           = v_row.free_period,
      paid_balance_micros   = v_row.paid_balance_micros,
      lifetime_spent_micros = lifetime_spent_micros + p_cost_micros,
      updated_at            = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.token_ledger (
    user_id, delta_micros, reason, reference, balance_after_micros,
    model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens
  )
  VALUES (
    p_user_id, -p_cost_micros, p_reason, p_reference, v_after,
    p_model, p_input_tokens, p_output_tokens, p_cache_write_tokens, p_cache_read_tokens
  );

  RETURN QUERY SELECT v_after, v_row.free_used_micros, v_row.paid_balance_micros;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_tokens(uuid, bigint, text, text, text, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_tokens(uuid, bigint, text, text, text, integer, integer, integer, integer)
  TO service_role;
