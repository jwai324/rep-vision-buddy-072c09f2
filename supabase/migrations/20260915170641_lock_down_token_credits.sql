-- Closes two independent ways for a client to mint itself unlimited AI credit.
-- Both were introduced by 20260518000000_token_credits_and_iap.sql and are live.

-- ---------------------------------------------------------------------------
-- 1. The three "Service role full access" policies carry no TO clause.
--
-- A policy without a role list applies to EVERY role, and permissive policies
-- OR together, so the owner-only SELECT policies beside them were decorative:
-- anon and authenticated had unrestricted SELECT/INSERT/UPDATE/DELETE on every
-- user's balance, ledger and purchase rows.
--
-- service_role bypasses RLS entirely, so these policies were never load-bearing
-- and are simply dropped rather than re-scoped. The same mistake was made and
-- fixed for user_ai_usage and ai_error_log in 20260411023736; that fix is the
-- precedent, this is the same bug on three newer tables.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access balance"   ON public.user_token_balance;
DROP POLICY IF EXISTS "Service role full access ledger"    ON public.token_ledger;
DROP POLICY IF EXISTS "Service role full access purchases" ON public.iap_purchases;

-- Defence in depth. RLS with no matching policy already refuses these, but the
-- underlying table grants should not be there either. SELECT is deliberately
-- left in place: ChatContext reads user_token_balance and CreditsScreen reads
-- token_ledger, both under the surviving owner-only SELECT policies.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_token_balance FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.token_ledger       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.iap_purchases      FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. consume_tokens and grant_tokens are executable by anon and authenticated.
--
-- 20260518000000 tried to lock them with REVOKE ALL ... FROM PUBLIC. That
-- removed nothing: Supabase grants EXECUTE on new functions in `public`
-- explicitly to anon, authenticated and service_role through default
-- privileges, not through PUBLIC. Both functions are SECURITY DEFINER, so they
-- run as their owner and ignore RLS — fixing the policies above does not close
-- this. Any caller holding the publishable key could grant any user id an
-- arbitrary balance, or drive another user's balance negative.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.consume_tokens(uuid, bigint, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_tokens(uuid, bigint, text, text)   FROM anon, authenticated;

-- Tidy-up only, and best effort: the grant survives this statement on the live
-- project (Supabase re-applies it), but handle_new_user returns `trigger`, and
-- PostgREST cannot expose a trigger-returning function as an RPC, so it is not
-- reachable over the API either way. Kept so the intent is on the record; the
-- security advisor flags it generically. Triggers check EXECUTE at CREATE
-- TRIGGER time rather than on each fire, so the signup trigger is unaffected.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- Stop the pattern recurring. New functions in `public` are not client-callable
-- unless a migration grants it on purpose. get_shared_item keeps the explicit
-- grant it was given in 20260817120000 — the public share page depends on it,
-- and prior grants are unaffected by this statement.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
