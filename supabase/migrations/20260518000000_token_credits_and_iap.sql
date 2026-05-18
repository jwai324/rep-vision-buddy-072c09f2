-- Token-based AI cost control + ad-hoc IAP purchases.
-- Replaces the flat 30 messages/day cap (user_ai_usage.message_count) with
-- real token metering in integer micro-USD (µ$ = USD * 1e6), a small free
-- monthly allowance, a paid balance, an append-only ledger, and idempotent
-- purchase records. Enforcement moves to the edge functions via the
-- consume_tokens / grant_tokens RPCs defined below.

-- ============================================================================
-- user_token_balance — 1:1 per user. Clients read-only; all writes via RPC.
-- ============================================================================
CREATE TABLE public.user_token_balance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  paid_balance_micros bigint NOT NULL DEFAULT 0,
  free_used_micros bigint NOT NULL DEFAULT 0,
  free_period text NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM'),
  lifetime_purchased_micros bigint NOT NULL DEFAULT 0,
  lifetime_spent_micros bigint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_token_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own balance" ON public.user_token_balance
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access balance" ON public.user_token_balance
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_user_token_balance_updated_at
  BEFORE UPDATE ON public.user_token_balance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- token_ledger — append-only audit trail. Server-only writes; users read own.
-- ============================================================================
CREATE TABLE public.token_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta_micros bigint NOT NULL,                       -- negative = spend, positive = grant
  reason text NOT NULL CHECK (reason IN (
    'ai_coach', 'generate_program', 'iap_purchase',
    'iap_subscription', 'admin_grant', 'refund_adjustment'
  )),
  reference text,
  balance_after_micros bigint NOT NULL,               -- snapshot: free_remaining + paid
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX token_ledger_user_created_idx
  ON public.token_ledger (user_id, created_at DESC);

ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ledger" ON public.token_ledger
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access ledger" ON public.token_ledger
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- iap_purchases — idempotent purchase records (stub now, real IAP in Phase 2).
-- transaction_id UNIQUE is the idempotency guarantee against replay/redelivery.
-- ============================================================================
CREATE TABLE public.iap_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'stub')),
  product_id text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  original_transaction_id text,
  status text NOT NULL DEFAULT 'granted'
    CHECK (status IN ('granted', 'pending', 'refunded', 'revoked')),
  granted_micros bigint NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.iap_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases" ON public.iap_purchases
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access purchases" ON public.iap_purchases
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_iap_purchases_updated_at
  BEFORE UPDATE ON public.iap_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- user_ai_usage — start recording REAL tokens + cache + cost (was unused).
-- ============================================================================
ALTER TABLE public.user_ai_usage
  ADD COLUMN IF NOT EXISTS total_cache_creation_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cache_read_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_micros bigint NOT NULL DEFAULT 0;

-- ============================================================================
-- Replace the stale admin view (it hardcoded outdated $1/$3-per-M pricing).
-- DROP + CREATE because the column set/order changes.
-- ============================================================================
DROP VIEW IF EXISTS public.ai_usage_daily_summary;
CREATE VIEW public.ai_usage_daily_summary
WITH (security_invoker = on) AS
SELECT
  date,
  count(*) AS total_users,
  sum(message_count) AS total_calls,
  sum(total_input_tokens) AS total_input_tokens,
  sum(total_output_tokens) AS total_output_tokens,
  sum(total_cache_creation_tokens) AS total_cache_creation_tokens,
  sum(total_cache_read_tokens) AS total_cache_read_tokens,
  round(sum(total_cost_micros) / 1000000.0, 4) AS cost_usd
FROM public.user_ai_usage
GROUP BY date
ORDER BY date DESC;

-- ============================================================================
-- consume_tokens — atomic free-then-paid deduction + ledger insert.
-- Row-locks (FOR UPDATE) so a turn's two near-simultaneous ai-coach calls (and
-- multi-device use) serialize correctly. Performs the authoritative lazy
-- monthly reset of the free allowance.
-- ============================================================================
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
  -- MUST match FREE_MONTHLY_MICROS in supabase/functions/_shared/pricing.ts
  v_free_cap   bigint := 500000;
  v_period     text   := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');
  v_row        public.user_token_balance%ROWTYPE;
  v_free_avail bigint;
  v_from_free  bigint;
  v_from_paid  bigint;
  v_after      bigint;
BEGIN
  INSERT INTO public.user_token_balance (user_id, free_period)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.user_token_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Lazy monthly reset of the free allowance.
  IF v_row.free_period <> v_period THEN
    v_row.free_used_micros := 0;
    v_row.free_period := v_period;
  END IF;

  -- Consume free monthly allowance first, then paid balance.
  v_free_avail := GREATEST(0, v_free_cap - v_row.free_used_micros);
  v_from_free  := LEAST(v_free_avail, p_cost_micros);
  v_from_paid  := p_cost_micros - v_from_free;

  v_row.free_used_micros    := v_row.free_used_micros + v_from_free;
  v_row.paid_balance_micros := v_row.paid_balance_micros - v_from_paid;  -- may go slightly negative

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

-- ============================================================================
-- grant_tokens — atomic paid grant + ledger insert. Used by the Phase 1 stub
-- and (Phase 2) by verify-iap on validated purchases.
-- ============================================================================
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
  v_free_cap bigint := 500000;  -- MUST match pricing.ts FREE_MONTHLY_MICROS
  v_period   text   := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM');
  v_row      public.user_token_balance%ROWTYPE;
  v_after    bigint;
BEGIN
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

-- Only the edge functions (service_role) may call these — not clients.
REVOKE ALL ON FUNCTION public.consume_tokens(uuid, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_tokens(uuid, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_tokens(uuid, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_tokens(uuid, bigint, text, text) TO service_role;
