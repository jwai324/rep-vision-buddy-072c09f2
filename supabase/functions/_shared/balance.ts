// Shared token-balance helpers for the edge functions. All mutating accounting
// goes through the Postgres RPCs `consume_tokens` / `grant_tokens` which row-lock
// (FOR UPDATE) so concurrent calls (e.g. a turn's initial + follow-up ai-coach
// invocations) serialize correctly — no read-modify-write race in TS.

import { monthlyAllowanceMicros, RESERVE_MICROS } from "./pricing.ts";

export interface BalanceRow {
  user_id: string;
  paid_balance_micros: number;
  free_used_micros: number;
  free_period: string;
  tier: string | null;
}

// UTC YYYY-MM. UTC is chosen to match the existing server UTC date convention;
// a documented minor wrinkle for users near a timezone boundary.
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

// Reads the balance row, lazily creating a zeroed row if absent (mirrors how
// user_ai_usage rows are created lazily — no auth.users trigger change needed).
export async function getOrInitBalance(
  supabase: any,
  userId: string,
): Promise<BalanceRow> {
  const [{ data }, { data: profile }] = await Promise.all([
    supabase
      .from("user_token_balance")
      .select("user_id, paid_balance_micros, free_used_micros, free_period")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const tier: string | null = profile?.subscription_tier ?? null;

  if (data) return { ...(data as Omit<BalanceRow, "tier">), tier };

  const fresh: BalanceRow = {
    user_id: userId,
    paid_balance_micros: 0,
    free_used_micros: 0,
    free_period: currentPeriod(),
    tier,
  };
  // Best-effort lazy insert; ignore conflicts (consume_tokens also self-inits).
  // tier is derived from profiles, not a column on user_token_balance.
  await supabase
    .from("user_token_balance")
    .insert({
      user_id: fresh.user_id,
      paid_balance_micros: fresh.paid_balance_micros,
      free_used_micros: fresh.free_used_micros,
      free_period: fresh.free_period,
    })
    .select()
    .maybeSingle();
  return fresh;
}

// Pure: project a fresh-month reset for display/gate purposes. The authoritative
// persisted reset happens inside the consume_tokens RPC.
export function applyLazyMonthlyReset(row: BalanceRow): BalanceRow {
  if (row.free_period !== currentPeriod()) {
    return { ...row, free_used_micros: 0, free_period: currentPeriod() };
  }
  return row;
}

export function availableMicros(row: BalanceRow): number {
  const cap = monthlyAllowanceMicros(row.tier);
  const freeRemaining = Math.max(0, cap - row.free_used_micros);
  return freeRemaining + row.paid_balance_micros;
}

export function gate(row: BalanceRow): { allowed: boolean; available: number } {
  const available = availableMicros(row);
  return { allowed: available >= RESERVE_MICROS, available };
}

// Atomic free-then-paid deduction + ledger insert (Postgres RPC, FOR UPDATE).
export async function consume(
  supabase: any,
  userId: string,
  cost: number,
  reason: string,
  reference: string,
): Promise<void> {
  const { error } = await supabase.rpc("consume_tokens", {
    p_user_id: userId,
    p_cost_micros: cost,
    p_reason: reason,
    p_reference: reference,
  });
  if (error) throw new Error(`consume_tokens failed: ${error.message}`);
}

// Atomic paid grant + ledger insert (Postgres RPC, FOR UPDATE).
export async function grantPaid(
  supabase: any,
  userId: string,
  micros: number,
  reason: string,
  reference: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("grant_tokens", {
    p_user_id: userId,
    p_micros: micros,
    p_reason: reason,
    p_reference: reference,
  });
  if (error) throw new Error(`grant_tokens failed: ${error.message}`);
  // RPC returns the new balance row(s); be tolerant of shape.
  const row = Array.isArray(data) ? data[0] : data;
  return row?.new_balance_micros ?? 0;
}

// Upsert the daily analytics aggregate in user_ai_usage (UTC date key, kept for
// continuity with historical rows and the ai_usage_daily_summary view).
export async function recordUsageAggregate(
  supabase: any,
  userId: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
  costMicrosValue: number,
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const inTok = Math.max(0, usage.input_tokens ?? 0);
  const outTok = Math.max(0, usage.output_tokens ?? 0);
  const ccTok = Math.max(0, usage.cache_creation_input_tokens ?? 0);
  const crTok = Math.max(0, usage.cache_read_input_tokens ?? 0);

  const { data: existing } = await supabase
    .from("user_ai_usage")
    .select("message_count, total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens, total_cost_micros")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("user_ai_usage")
      .update({
        message_count: (existing.message_count ?? 0) + 1,
        total_input_tokens: (existing.total_input_tokens ?? 0) + inTok,
        total_output_tokens: (existing.total_output_tokens ?? 0) + outTok,
        total_cache_creation_tokens: (existing.total_cache_creation_tokens ?? 0) + ccTok,
        total_cache_read_tokens: (existing.total_cache_read_tokens ?? 0) + crTok,
        total_cost_micros: (existing.total_cost_micros ?? 0) + costMicrosValue,
      })
      .eq("user_id", userId)
      .eq("date", today);
  } else {
    await supabase.from("user_ai_usage").insert({
      user_id: userId,
      date: today,
      message_count: 1,
      total_input_tokens: inTok,
      total_output_tokens: outTok,
      total_cache_creation_tokens: ccTok,
      total_cache_read_tokens: crTok,
      total_cost_micros: costMicrosValue,
    });
  }
}
