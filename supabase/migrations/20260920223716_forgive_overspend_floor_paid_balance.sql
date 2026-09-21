-- Audit 2.20 — a small end-of-month overspend was recorded against the user
-- and then hidden.
--
-- consume_tokens charged the part of a turn the monthly allowance could not
-- cover against paid_balance_micros without a floor, so a turn that cost a
-- little more than the balance left drove that column negative. The credits
-- screen showed Purchased through a Math.max(0, ...), so the debt never
-- appeared: the three figures on screen stopped adding up, and the next
-- month's allowance was silently netted against a number the user could not
-- see (available = free_remaining + paid, with paid negative).
--
-- The owner's decision is to FORGIVE the overshoot: a new month always starts
-- at the full allowance and the operator absorbs the difference. That is a
-- one-line change — the paid balance floors at zero — plus a sweep of the
-- balances that already went negative, because forgiving future overspend
-- while leaving past debt on the books would be the same defect with a date
-- on it.
--
-- Deliberately unchanged:
--   * delta_micros on the ledger row is still the full cost. The spend really
--     happened and is still recorded as usage; only the balance is forgiven.
--   * lifetime_spent_micros still accumulates the full cost.
--   * free_used_micros, the lazy monthly reset, the RETURNS TABLE shape, the
--     SECURITY DEFINER / search_path settings and the existing grants.
--   * balance_after_micros is computed AFTER the floor is applied, so the
--     ledger's stated balance is the balance the row actually holds.
--
-- The function is replaced in place (identical signature) so the REVOKE/GRANT
-- set from 20260915200720_ai_turn_slot_lifecycle_and_repriceable_ledger.sql
-- survives; they are re-asserted at the end regardless.

CREATE OR REPLACE FUNCTION public.consume_tokens(
  p_user_id            uuid,
  p_cost_micros        bigint,
  p_reason             text,
  p_reference          text,
  p_model              text    DEFAULT NULL,
  p_input_tokens       integer DEFAULT NULL,
  p_output_tokens      integer DEFAULT NULL,
  p_cache_write_tokens integer DEFAULT NULL,
  p_cache_read_tokens  integer DEFAULT NULL
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

  v_row.free_used_micros := v_row.free_used_micros + v_from_free;

  -- The floor. What the paid balance cannot cover is absorbed rather than
  -- carried as a debt into next month. GREATEST also heals a row that is
  -- already negative, which is the same rule the sweep below applies once.
  v_row.paid_balance_micros := GREATEST(0, v_row.paid_balance_micros - v_from_paid);

  -- Computed from the floored value, so the ledger's balance_after_micros is
  -- what the row now holds rather than the un-floored arithmetic result.
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

COMMENT ON COLUMN public.user_token_balance.paid_balance_micros IS
  'Purchased credit balance in micro-dollars. Never negative: consume_tokens floors it at zero and an overspend it cannot cover is absorbed by the operator (audit 2.20). grant_tokens is the only other writer and only adds.';

-- Sweep the balances that already went negative before the floor existed.
-- At the time this was written one row of three was negative, by 615,274
-- micros (~615 credits, ~$0.62); the statement is a no-op if that row has
-- since been corrected by hand.
--
-- No token_ledger row is written for the forgiveness. The decision was to
-- forgive, not to disclose, and a positive adjustment would surface in the
-- credits screen's "Recent activity" list as an unexplained refund. The spend
-- that caused it is already in the ledger at its full cost.
UPDATE public.user_token_balance
SET paid_balance_micros = 0,
    updated_at          = now()
WHERE paid_balance_micros < 0;
