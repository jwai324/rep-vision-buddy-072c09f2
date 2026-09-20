-- Audit 13.7 — the top-up receipt would record the wrong figure.
--
-- Every other reader of user_token_balance applies the lazy monthly reset
-- before it does arithmetic with free_used_micros:
--
--   * consume_tokens  — resets in memory and persists it in its UPDATE
--   * begin_ai_turn   — the same block, persisted in both of its branches
--   * _shared/balance.ts applyLazyMonthlyReset() and src/utils/credits.ts —
--     the same rule as a pure projection for the gate and the credits screen
--
-- grant_tokens is the only one that does not. It reads the row FOR UPDATE,
-- adds the purchase to paid_balance_micros, and then computes
--
--   v_after := GREATEST(0, v_free_cap - v_row.free_used_micros) + paid
--
-- from a free_used_micros that may belong to a previous month. When it does,
-- v_after is understated by up to a whole monthly allowance (500,000 µ$ free,
-- 7,000,000 µ$ premium) and that understated figure is written into
-- token_ledger.balance_after_micros — an append-only table, so the receipt is
-- wrong permanently, and it disagrees with the balance the credits screen
-- shows beside it, which does apply the reset.
--
-- The balance itself was never wrong: grant_tokens did not persist the stale
-- free_used_micros anywhere, and the next consume_tokens / begin_ai_turn does
-- the reset itself. Only the recorded receipt was. Paid top-ups have never
-- been switched on (grant-tokens has never been deployed), so this has never
-- run in production.
--
-- The fix is the reset block, copied from consume_tokens **verbatim** and
-- placed in the same position — immediately after the FOR UPDATE select and
-- before any use of v_row.free_used_micros. There is no shared helper for it:
-- the reset is inline in consume_tokens and in begin_ai_turn, and those two
-- copies are already textually identical. This is the third copy of the same
-- five lines, kept character-for-character identical to the other two so a
-- future change can be applied to all three by search:
--
--   IF v_row.free_period <> v_period THEN
--     v_row.free_used_micros := 0;
--     v_row.free_period := v_period;
--   END IF;
--
-- As in consume_tokens and begin_ai_turn, the reset is also written back in
-- the function's existing UPDATE (free_used_micros / free_period from v_row).
-- Persisting is what the other two do, and a half-applied reset — a ledger row
-- stating the new month's balance while the row it came from still says last
-- month — would be a new inconsistency of its own. When no reset is due those
-- two assignments write back the values just read under the row lock, which is
-- exactly what begin_ai_turn does.
--
-- Deliberately unchanged: the signature and RETURNS TABLE shape, the
-- SECURITY DEFINER / search_path settings, the tier lookup and its fallback,
-- the lazy row insert, the FOR UPDATE lock, the paid/lifetime arithmetic, the
-- ledger insert and the return value. The body below is otherwise the
-- deployed body verbatim, so `pg_get_functiondef` before and after differs
-- only by the reset block and the two UPDATE assignments.
--
-- NOT fixed here, and still true: grant_tokens is an uncapped credit faucet.
-- It credits whatever p_user_id it is handed, with no ceiling on p_micros, and
-- its only caller (the grant-tokens edge function) gates on a static
-- x-admin-secret header and takes target_user_id straight from the request
-- body. CLAUDE.md records that the function must verify the caller's JWT, drop
-- target_user_id and bound the amount before it ever ships. This migration
-- does not change any of that, and grant-tokens remains unsafe to deploy.

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
  v_free_cap bigint;
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

  IF v_row.free_period <> v_period THEN
    v_row.free_used_micros := 0;
    v_row.free_period := v_period;
  END IF;

  UPDATE public.user_token_balance
  SET paid_balance_micros       = paid_balance_micros + p_micros,
      lifetime_purchased_micros = lifetime_purchased_micros + p_micros,
      free_used_micros          = v_row.free_used_micros,
      free_period               = v_row.free_period,
      updated_at                = now()
  WHERE user_id = p_user_id
  RETURNING paid_balance_micros INTO v_row.paid_balance_micros;

  v_after := GREATEST(0, v_free_cap - v_row.free_used_micros) + v_row.paid_balance_micros;

  INSERT INTO public.token_ledger (user_id, delta_micros, reason, reference, balance_after_micros)
  VALUES (p_user_id, p_micros, p_reason, p_reference, v_after);

  RETURN QUERY SELECT v_after;
END;
$$;

-- CREATE OR REPLACE keeps the existing ACL ({postgres,service_role} as of
-- 2026-09-20), but the lock-down from 20260915170641 is re-asserted here so
-- the function cannot end up client-callable through some later replacement.
REVOKE EXECUTE ON FUNCTION public.grant_tokens(uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_tokens(uuid, bigint, text, text)
  TO service_role;
