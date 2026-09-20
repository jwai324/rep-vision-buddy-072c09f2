// Shared token-balance helpers for the edge functions. All mutating accounting
// goes through the Postgres RPCs `consume_tokens` / `grant_tokens` which row-lock
// (FOR UPDATE) so concurrent calls (e.g. a turn's initial + follow-up ai-coach
// invocations) serialize correctly — no read-modify-write race in TS. The daily
// usage aggregate goes through `record_ai_usage` for the same reason: it is one
// upsert that increments, not a read and a write.

import { monthlyAllowanceMicros, RESERVE_MICROS } from "./pricing.ts";

// Minimal structural type for the subset of the Supabase client the helpers
// in this file touch. We can't import SupabaseClient from esm.sh at type-check
// time (Deno-first), so this stays a duck-typed contract — enough to catch
// callsite typos without pulling in the full generated Database type.
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: any }>;
}

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
  supabase: SupabaseLike,
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

// What a ledger row needs to be re-priced if the rates change again. The 3x
// overcharge found on 2026-09-15 could not be corrected because rows held only
// micro-dollars; the token counts behind them were gone.
export interface LedgerTokens {
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_write_tokens: number | null;
  cache_read_tokens: number | null;
}

// Atomic free-then-paid deduction + ledger insert (Postgres RPC, FOR UPDATE).
export async function consume(
  supabase: SupabaseLike,
  userId: string,
  cost: number,
  reason: string,
  reference: string,
  tokens?: LedgerTokens,
): Promise<void> {
  const { error } = await supabase.rpc("consume_tokens", {
    p_user_id: userId,
    p_cost_micros: cost,
    p_reason: reason,
    p_reference: reference,
    p_model: tokens?.model ?? null,
    p_input_tokens: tokens?.input_tokens ?? null,
    p_output_tokens: tokens?.output_tokens ?? null,
    p_cache_write_tokens: tokens?.cache_write_tokens ?? null,
    p_cache_read_tokens: tokens?.cache_read_tokens ?? null,
  });
  if (error) throw new Error(`consume_tokens failed: ${error.message}`);
}

// Atomic paid grant + ledger insert (Postgres RPC, FOR UPDATE).
export async function grantPaid(
  supabase: SupabaseLike,
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

// Non-negative integer, or 0 for anything that isn't a finite number. The
// counters land in integer/bigint columns, and a fractional or NaN value is
// rejected by Postgres at the RPC boundary rather than stored.
function counter(value: number | null | undefined): number {
  return Number.isFinite(value as number) ? Math.max(0, Math.round(value as number)) : 0;
}

// Adds one turn to the daily analytics aggregate in user_ai_usage (UTC date
// key, kept for continuity with historical rows and the ai_usage_daily_summary
// view) through the `record_ai_usage` RPC — one INSERT .. ON CONFLICT DO UPDATE
// that increments the stored counters. Read-modify-write in TS lost a turn
// whenever two settled at once, and collided on the unique key on the first
// turn of a day (audit 9.4).
//
// This is reporting, not billing: it never throws. A user's coach turn must not
// fail because the operator's usage report could not be written — but the
// failure is logged rather than swallowed, because an aggregate that quietly
// stops being written is exactly the defect it is being fixed for.
export async function recordUsageAggregate(
  supabase: SupabaseLike,
  userId: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
  costMicrosValue: number,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("record_ai_usage", {
      p_user_id: userId,
      p_input_tokens: counter(usage?.input_tokens),
      p_output_tokens: counter(usage?.output_tokens),
      p_cache_creation_tokens: counter(usage?.cache_creation_input_tokens),
      p_cache_read_tokens: counter(usage?.cache_read_input_tokens),
      p_cost_micros: counter(costMicrosValue),
    });
    if (error) {
      console.error(
        `record_ai_usage failed for ${userId}: ${error?.message ?? String(error)}`,
      );
    }
  } catch (e) {
    console.error(
      `record_ai_usage threw for ${userId}: ${String((e as { message?: string } | undefined)?.message ?? e)}`,
    );
  }
}
