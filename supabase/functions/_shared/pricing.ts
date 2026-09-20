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
  // Own-property only: a bare index would resolve "constructor", "toString" and
  // friends to a function, skip the fallback below, and multiply tokens by a
  // non-number — sending NaN micro-dollars into consume_tokens.
  const table = RATES_BY_MODEL as Record<string, typeof RATES_BY_MODEL[PricedModel]>;
  const rates = Object.prototype.hasOwnProperty.call(table, model) ? table[model] : undefined;
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

// Paid subscription monthly grant. Originally sized as "30 turns/day * 30 days
// * ~$0.05/turn"; at the measured AVG_TURN_MICROS below it buys ~560 turns
// (~19/day), which is the figure to reason with. The grant itself is unchanged.
export const PAID_MONTHLY_GRANT_MICROS = 45_000_000;

// ---- What a turn actually costs ----------------------------------------------------
//
// AVG_TURN_MICROS and RESERVE_MICROS were both 50_000 and both wrong: they were
// set before prompt caching existed and before a turn could run more than one
// metered round. The working below is from the rate card at the top of this file
// (claude-opus-4-7, micro-dollars per TOKEN: input 5, output 25, cache write
// 6.25, cache read 0.5) and the cached prefix (SYSTEM_PROMPT + stable context +
// tool definitions, everything up to the cache_control marker).
//
// SIZE OF THAT PREFIX. CLAUDE.md says ~23,000 tokens; that figure is stale and
// the ledger refutes it. `available_exercises` is ~71 KB on its own and is NOT
// in VOLATILE_CONTEXT_KEYS, so the whole exercise library sits inside the
// cached block: system prompt (~12.7 KB) + library (~71 KB) + tool schemas
// (~12.5 KB) + profile is ~97 KB, which is 35,000-40,000 tokens of dense JSON.
// Back-solving the ledger's own cache-write rows agrees and lands a little
// higher: a 313,000-micro round (real, after dividing out the old 3x rates)
// minus ~700 output tokens and ~2,000 uncached input tokens leaves ~285,000 at
// the 6.25 write rate, i.e. ~45,000 tokens. Take the prefix as 36,000-45,000.
//
// The arithmetic below is therefore an ESTIMATE, not a measurement, because
// every ledger row predates both the rate fix and the cache split. Re-derive it
// from the first twenty rows written after 2026-09-15: those record the model
// and all four token counts, so the real figure can simply be read off.
//
// Per round on top of that prefix: ~2,000 uncached input tokens (the unmarked
// volatile context block plus the message window) and ~700 output tokens.
// Taking the prefix at 40,000 tokens, the middle of the range above:
//
//   first round, cache HIT      40,000 * 0.5  =  20,000   cache read
//                                2,000 * 5    =  10,000   uncached input
//                                  700 * 25   =  17,500   output
//                                              = ~47,500
//
//   first round, cache WRITE    40,000 * 6.25 = 250,000   cache write
//     (first turn of a session   2,000 * 5    =  10,000
//      or after the 5m TTL)        700 * 25   =  17,500
//                                              = ~277,500
//
//   each extra metered round    40,000 * 0.5  =  20,000   warm cache
//     (MAX_ASSISTANT_ROUNDS       1,000 * 5   =   5,000   tool results
//      is 3 in ChatContext;         500 * 25  =  12,500
//      rounds 2-3 are warm)                    = ~37,500
//
// So: ~47,500 for the cheapest real turn, ~122,000 for a warm three-round turn,
// ~277,500 for a cold one-round turn, ~352,000 cold and three rounds. The hard
// ceiling is MAX_TOKENS (8,000) * 25 = 200,000 of output per round.
//
// Against the ledger (44 metered ROUNDS, not turns — they pair up as an
// expensive first round and a cheap follow-up seconds later; every one inflated
// 3x by the old rate table and predating the cache split, so divide by three):
// 25 rounds at 27k-53k real, which is the cache-read arithmetic, and 19 at
// 242k-383k real, which is that same prefix being written at the write rate.
// In that era the prefix was rewritten on EVERY turn, which is the bug
// VOLATILE_CONTEXT_KEYS fixed; a write now happens only on the first turn of a
// session or after the cache expires, so the mix below, not the old mean, is
// what a turn costs today.

// Display only: the "≈ N messages left" estimate. Never used for accounting.
// Blended so it is honest rather than flattering — roughly one turn in four
// writes the cache (a short session, or a gap past the 5-minute TTL) and
// roughly one in three runs a second or third round:
//   0.75 * 47,500 + 0.25 * 277,500 = 105,000
//   + 0.3 * 37,500                  =  11,250
//                                   ≈ 110,000
// It is deliberately NOT the cheap cache-hit figure: a user who is told how
// many messages they have left should not be surprised by the first cold one.
export const AVG_TURN_MICROS = 110_000;

// Pre-call gate: the balance held before a turn starts. The exact cost is
// unknowable before the call, so we gate on having at least this much and debit
// the real cost afterwards; the overshoot is forgiven rather than billed as
// debt, so an under-sized reserve costs the operator, not the user.
//
// 100,000 is one fifth of the free monthly allowance (500,000) and about 2.5
// cache-hit turns, so it fully covers the common turn while leaving four fifths
// of a free month spendable. generate-program holds the same reserve and the
// four program generations in the ledger cost 79k-118k real, so 100,000 covers
// a typical one of those outright too. Sizing it at the ~229,000 worst case would instead
// put nearly half of a free month out of reach — the balance would read as
// "out of credits" with $0.23 of $0.50 unspent. What the operator carries is
// bounded: at most (turn cost - 100,000) per runaway turn, and at most
// MAX_CONCURRENT_TURNS (3) of those in flight at once.
//
// Note that begin_ai_turn gates on `available >= p_reserve_micros *
// (in_flight + 1)`, so this figure is per CONCURRENT turn: a second turn
// started while one is running needs 200,000, a third 300,000. The one-fifth
// budget above is about the ordinary serial case, which is the only one a
// single client produces.
export const RESERVE_MICROS = 100_000;

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
