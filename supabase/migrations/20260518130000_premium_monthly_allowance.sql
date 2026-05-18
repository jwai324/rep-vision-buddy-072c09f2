-- Premium monthly allowance. The monthly metered allowance is now tier-based:
--   free    -> $0.50 / month (500,000 µ$)
--   premium -> $7.00 / month (7,000,000 µ$)
-- consume_tokens / grant_tokens derive the cap from profiles.subscription_tier
-- (server-authoritative; the client cannot influence it). Premium is metered
-- like free, just with a larger bucket — it no longer bypasses the gate.

CREATE OR REPLACE FUNCTION public.consume_tokens(
  p_user_id uuid,
  p_cost_micros bigint,
  p_reason text,
  p_reference text
)
RETURNS TABLE (
  new_balance_micros bigint,
  free_used_micros bigint,
  paid_balance_micros bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Tier-based monthly allowance. MUST match monthlyAllowanceMicros() in
  -- supabase/functions/_shared/pricing.ts and src/utils/credits.ts.
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
    v_free_cap := 500000;  -- no profile row: conservative free cap
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

  INSERT INTO public.token_ledger (user_id, delta_micros, reason, reference, balance_after_micros)
  VALUES (p_user_id, -p_cost_micros, p_reason, p_reference, v_after);

  RETURN QUERY SELECT v_after, v_row.free_used_micros, v_row.paid_balance_micros;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_tokens(
  p_user_id uuid,
  p_micros bigint,
  p_reason text,
  p_reference text
)
RETURNS TABLE (new_balance_micros bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free_cap bigint;  -- tier-based; see consume_tokens
  v_period   text   := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');
  v_row      public.user_token_balance%ROWTYPE;
  v_after    bigint;
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

  UPDATE public.user_token_balance
  SET paid_balance_micros       = paid_balance_micros + p_micros,
      lifetime_purchased_micros = lifetime_purchased_micros + p_micros,
      updated_at                = now()
  WHERE user_id = p_user_id
  RETURNING paid_balance_micros INTO v_row.paid_balance_micros;

  v_after := GREATEST(0, v_free_cap - v_row.free_used_micros) + v_row.paid_balance_micros;

  INSERT INTO public.token_ledger (user_id, delta_micros, reason, reference, balance_after_micros)
  VALUES (p_user_id, p_micros, p_reason, p_reference, v_after);

  RETURN QUERY SELECT v_after;
END;
$$;
