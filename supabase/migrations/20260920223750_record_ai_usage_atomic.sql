-- Audit 9.4 — the daily usage tally could lose entries.
--
-- recordUsageAggregate (supabase/functions/_shared/balance.ts) read today's
-- user_ai_usage row, added a turn's counters in TypeScript and wrote the sum
-- back, with no lock — which contradicts that file's own header ("no
-- read-modify-write race in TS"). Two turns settling at once both read the
-- same row and the second write overwrote the first, losing a turn's tokens
-- and cost; and on the first turn of a UTC day two concurrent settlements both
-- took the INSERT branch, where the loser hit the
-- user_ai_usage_user_id_date_key unique constraint and its error was
-- discarded unread.
--
-- Billing is not affected — that is consume_tokens, which row-locks
-- FOR UPDATE. This table is the operator's own usage report (and the source of
-- the ai_usage_daily_summary view), so the damage is an undercount, not a
-- miss-charge.
--
-- The fix is one statement: an upsert whose ON CONFLICT branch INCREMENTS the
-- stored counters rather than replacing them. Postgres takes a row lock on the
-- conflicting row for the duration of the DO UPDATE, so concurrent callers
-- serialize on it and every turn lands exactly once.
--
-- Notes on the choices here:
--   * The date key is computed server-side as UTC, the same convention
--     consume_tokens uses for free_period and the same value the TypeScript
--     was computing from the edge runtime's clock. The project database runs
--     in UTC, so this changes no row's key; it just removes a second clock.
--   * Counters are clamped at zero so a nonsense usage payload cannot walk a
--     total backwards. The columns are integer (cost is bigint), unchanged.
--   * updated_at is left to the existing update_user_ai_usage_updated_at
--     BEFORE UPDATE trigger, which fires on the DO UPDATE branch.
--   * SECURITY DEFINER with search_path pinned, granted to service_role only,
--     exactly like consume_tokens / begin_ai_turn / end_ai_turn. The edge
--     functions call it with the service role. No new client-reachable
--     surface: 20260917232441_lock_down_user_ai_usage.sql took INSERT/UPDATE
--     on this table away from anon and authenticated, and this function must
--     not hand it back.

CREATE OR REPLACE FUNCTION public.record_ai_usage(
  p_user_id               uuid,
  p_input_tokens          integer DEFAULT 0,
  p_output_tokens         integer DEFAULT 0,
  p_cache_creation_tokens integer DEFAULT 0,
  p_cache_read_tokens     integer DEFAULT 0,
  p_cost_micros           bigint  DEFAULT 0
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.user_ai_usage (
    user_id,
    date,
    message_count,
    total_input_tokens,
    total_output_tokens,
    total_cache_creation_tokens,
    total_cache_read_tokens,
    total_cost_micros
  )
  VALUES (
    p_user_id,
    to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD'),
    1,
    GREATEST(0, COALESCE(p_input_tokens, 0)),
    GREATEST(0, COALESCE(p_output_tokens, 0)),
    GREATEST(0, COALESCE(p_cache_creation_tokens, 0)),
    GREATEST(0, COALESCE(p_cache_read_tokens, 0)),
    GREATEST(0, COALESCE(p_cost_micros, 0))
  )
  ON CONFLICT (user_id, date) DO UPDATE
  SET message_count               = public.user_ai_usage.message_count + 1,
      total_input_tokens          = public.user_ai_usage.total_input_tokens + EXCLUDED.total_input_tokens,
      total_output_tokens         = public.user_ai_usage.total_output_tokens + EXCLUDED.total_output_tokens,
      total_cache_creation_tokens = public.user_ai_usage.total_cache_creation_tokens + EXCLUDED.total_cache_creation_tokens,
      total_cache_read_tokens     = public.user_ai_usage.total_cache_read_tokens + EXCLUDED.total_cache_read_tokens,
      total_cost_micros           = public.user_ai_usage.total_cost_micros + EXCLUDED.total_cost_micros;
$$;

COMMENT ON FUNCTION public.record_ai_usage(uuid, integer, integer, integer, integer, bigint) IS
  'Adds one AI turn''s token counts and cost to the caller''s user_ai_usage row for the current UTC day, creating the row if it is the day''s first turn. One statement, safe to call concurrently (audit 9.4). Reporting only — billing goes through consume_tokens.';

REVOKE EXECUTE ON FUNCTION public.record_ai_usage(uuid, integer, integer, integer, integer, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(uuid, integer, integer, integer, integer, bigint)
  TO service_role;
