// Single source of truth for AI token cost accounting.
//
// All internal accounting is integer micro-USD (µ$ = USD * 1_000_000) to avoid
// floating-point drift. Rates are expressed as integer µ$ per MILLION tokens,
// so a single Math.ceil at the end yields a deterministic integer µ$ cost that
// always rounds in our favor.
//
// VERIFY against https://www.anthropic.com/pricing at execution/deploy time —
// model pricing drifts. These are the claude-opus-4-7 list rates:
//   input            $5    / MTok
//   output           $25   / MTok
//   cache write (5m) $6.25 / MTok  (1.25x input)
//   cache read       $0.50 / MTok  (0.10x input)
//
// These were $15/$75 (the Opus 4 / 4.1 rates) until 2026-09-15, so every debit,
// every allowance and the operator cost view were 3x the real spend. Ledger rows
// store only micro-dollars and not token counts, so history before that date
// cannot be re-priced — treat pre-2026-09-15 ledger totals as 3x inflated.
//
// RATES_BY_MODEL is keyed so a model swap cannot silently leave the price
// behind: MODEL in each edge function must have an entry here.
export const RATES_BY_MODEL = {
  "claude-opus-4-7": { input: 5_000_000, output: 25_000_000, cache_write: 6_250_000, cache_read: 500_000 },
  "claude-sonnet-4-6": { input: 3_000_000, output: 15_000_000, cache_write: 3_750_000, cache_read: 300_000 },
} as const;

export type PricedModel = keyof typeof RATES_BY_MODEL;

export function ratesForModel(model: string) {
  const rates = (RATES_BY_MODEL as Record<string, typeof RATES_BY_MODEL[PricedModel]>)[model];
  if (!rates) {
    // Bill at the most expensive known rate rather than under-charging, and make
    // the omission loud in the function logs.
    console.error(`pricing: no rate table for model "${model}" — billing at the highest known rate`);
    return RATES_BY_MODEL["claude-opus-4-7"];
  }
  return rates;
}

export const RATES_MICROS_PER_MTOK = RATES_BY_MODEL["claude-opus-4-7"];

export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// Deterministic integer µ$ cost for one Anthropic API call. Pass the model that
// produced the usage; it defaults to the Opus rate table for older callers.
export function costMicros(usage: AnthropicUsage | null | undefined, model?: string): number {
  if (!usage) return 0;
  const rates = model ? ratesForModel(model) : RATES_MICROS_PER_MTOK;
  const input = Math.max(0, usage.input_tokens ?? 0);
  const output = Math.max(0, usage.output_tokens ?? 0);
  const cacheWrite = Math.max(0, usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Math.max(0, usage.cache_read_input_tokens ?? 0);

  const totalMicrosTimesM =
    input * rates.input +
    output * rates.output +
    cacheWrite * rates.cache_write +
    cacheRead * rates.cache_read;

  return Math.ceil(totalMicrosTimesM / 1_000_000);
}

// ---- Display / allowance constants -------------------------------------------------
// NOTE: the client mirrors the display-only subset of these in src/utils/credits.ts.
// Keep the two in sync (documented coupling — server is authoritative).

// 1 credit = $0.001 (one tenth of a cent). Keeps the displayed balance a
// friendly 3-4 digit number rather than a fractional cent value.
export const MICROS_PER_CREDIT = 1000;

// Tier-based monthly metered allowance, lazily reset each calendar month.
// MUST match the CASE in the consume_tokens / grant_tokens RPCs and the
// client mirror in src/utils/credits.ts.
//   free    -> ~$0.50 / month
//   premium -> ~$7.00 / month
export const FREE_MONTHLY_MICROS = 500_000;
export const PREMIUM_MONTHLY_MICROS = 7_000_000;

export function monthlyAllowanceMicros(tier: string | null | undefined): number {
  return tier === "premium" ? PREMIUM_MONTHLY_MICROS : FREE_MONTHLY_MICROS;
}

// Paid subscription monthly grant — roughly "30 messages/day for a month".
// 30 turns/day * 30 days * ~$0.05/turn. TUNE from real token_ledger data once
// observed; this is a conservative placeholder.
export const PAID_MONTHLY_GRANT_MICROS = 45_000_000;

// Rough average metered cost of one user turn (up to 2 API calls). Used only
// for the client "≈ N messages left" estimate, never for accounting.
export const AVG_TURN_MICROS = 50_000;

// Pre-call gate threshold: roughly one expensive turn. We can't know the exact
// cost before the call, so we gate on having at least this much available and
// deduct the real cost afterward (bounded overshoot of ~1 turn).
export const RESERVE_MICROS = 50_000;

export function creditsFromMicros(micros: number): number {
  return Math.floor(micros / MICROS_PER_CREDIT);
}

// Phase 2 (IAP): server-side product -> micros map. Never trust client amounts.
export const IAP_PRODUCTS: Record<string, { micros: number; reason: string }> = {
  repvision_pro_monthly: { micros: PAID_MONTHLY_GRANT_MICROS, reason: "iap_subscription" },
  repvision_topup_small: { micros: 5_000_000, reason: "iap_purchase" },
  repvision_topup_large: { micros: 20_000_000, reason: "iap_purchase" },
};

// Stub-only packs for the Phase 1 grant-tokens test endpoint.
export const STUB_PACKS: Record<string, { micros: number; reason: string }> = {
  topup_small: { micros: 5_000_000, reason: "iap_purchase" },
  topup_large: { micros: 20_000_000, reason: "iap_purchase" },
  sub_month: { micros: PAID_MONTHLY_GRANT_MICROS, reason: "iap_subscription" },
};
