-- user_ai_usage is the per-user, per-day token and cost aggregate behind the
-- operator's ai_usage_daily_summary view. Only the edge functions write it,
-- through the service role — but two policies let any signed-in user INSERT
-- and UPDATE their own rows from the browser, so the accounting could be
-- rewritten by the person being accounted for. The owner-only SELECT policy is
-- left alone: nothing in the client reads this table today (the credits screen
-- reads token_ledger), and an owner-scoped read is harmless.
DROP POLICY IF EXISTS "Users can insert own usage" ON public.user_ai_usage;
DROP POLICY IF EXISTS "Users can update own usage" ON public.user_ai_usage;

-- Belt and braces, matching what lock_down_token_credits did for the balance
-- tables: RLS is the gate, but a future permissive policy would reopen it, and
-- the table-level grant is what a policy needs to be reachable at all.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_ai_usage FROM anon, authenticated;
