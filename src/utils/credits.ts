// Client mirror of the DISPLAY-ONLY token constants. The server
// (supabase/functions/_shared/pricing.ts) is the authoritative source of truth
// for accounting; these must be kept in sync with it (documented coupling).

export const MICROS_PER_CREDIT = 1000; // 1 credit = $0.001
// Tier-based monthly allowance — mirror of pricing.ts / the SQL RPCs.
export const FREE_MONTHLY_MICROS = 500_000; // ~$0.50 / month
export const PREMIUM_MONTHLY_MICROS = 7_000_000; // ~$7.00 / month
export function monthlyAllowanceMicros(tier: string | null | undefined): number {
  return tier === 'premium' ? PREMIUM_MONTHLY_MICROS : FREE_MONTHLY_MICROS;
}
// Blended cost of one coach turn, for the "≈ N messages left" estimate only.
// ~47.5k micros when the prompt cache hits, ~277.5k when it is written, ~37.5k
// per extra metered round; pricing.ts carries the full arithmetic, the size of
// the cached prefix it rests on, and is the source of truth. A turn is NOT the
// 50k these two used to share.
export const AVG_TURN_MICROS = 110_000;
// Server pre-call gate threshold — one fifth of the free monthly allowance.
// Mirror of pricing.ts; the server decides, this only shapes the display.
export const RESERVE_MICROS = 100_000;
export const LOW_THRESHOLD = 2 * AVG_TURN_MICROS;

export function currentPeriodUTC(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM, UTC
}

export function creditsFromMicros(micros: number): number {
  return Math.max(0, Math.floor(micros / MICROS_PER_CREDIT));
}

// The estimate and the gate must agree in both directions. Below the reserve
// the gate refuses, so the estimate is 0 however the division rounds; at or
// above it the gate lets one through, so the estimate is never 0 even though
// the blended average is larger than the reserve. Without both clamps a balance
// between the two constants reads "≈ 1 message left" on a screen that calls it
// exhausted, or "0 left" on a screen that will happily send one.
export function estMessagesLeft(availableMicros: number): number {
  if (availableMicros < RESERVE_MICROS) return 0;
  return Math.max(1, Math.floor(availableMicros / AVG_TURN_MICROS));
}

export interface CreditsBalance {
  availableMicros: number;
  paidMicros: number;
  freeRemainingMicros: number;
  credits: number;
  estMessagesLeft: number;
  lowBalance: boolean;
  exhausted: boolean;
}

// Derive the display balance from raw row values, applying a client-side lazy
// monthly reset for display (the server reset is authoritative).
export function deriveBalance(
  row: {
    paid_balance_micros: number;
    free_used_micros: number;
    free_period: string;
  } | null,
  tier: string | null | undefined,
): CreditsBalance {
  const cap = monthlyAllowanceMicros(tier);
  const paid = row?.paid_balance_micros ?? 0;
  const freeUsed =
    !row || row.free_period !== currentPeriodUTC() ? 0 : row.free_used_micros;
  const freeRemaining = Math.max(0, cap - freeUsed);
  const available = freeRemaining + paid;
  return {
    availableMicros: available,
    paidMicros: paid,
    freeRemainingMicros: freeRemaining,
    credits: creditsFromMicros(available),
    estMessagesLeft: estMessagesLeft(available),
    lowBalance: available < LOW_THRESHOLD,
    exhausted: available < RESERVE_MICROS,
  };
}

/**
 * The two rows under the headline balance on the credits screen, in credits,
 * always summing to it.
 *
 * Purchased used to be printed through a `Math.max(0, paidMicros)`, which is
 * what hid an end-of-month overspend: `consume_tokens` charged the uncovered
 * part of a turn against the paid balance with no floor, so the column went
 * negative, the headline (free + paid) was quietly reduced by the debt, and
 * Purchased still read 0 — three figures that no longer added up. The server
 * now floors that balance at zero and forgives the overshoot
 * (`20260920223716_forgive_overspend_floor_paid_balance.sql`), so there is nothing
 * left for a clamp to hide and none is applied here.
 *
 * What remains is rounding. The headline is `floor((free + paid) / 1000)`;
 * flooring the two rows independently drops the sub-credit remainder the
 * headline keeps, which leaves "500" and "0" sitting under a headline of 501.
 * Purchased is floored on its own — a figure the user paid for must never read
 * higher than what they hold — and the allowance row carries the remainder.
 *
 * The subtraction cannot go negative: `paidMicros >= 0` makes
 * `floor((free + paid) / 1000) >= floor(paid / 1000)`, and a row still holding
 * a pre-migration negative gives `purchased = 0` against a non-negative
 * headline. In that case the debt nets out of the allowance row rather than
 * disappearing, so the figures reconcile through the transition too.
 */
export function creditsBreakdown(balance: CreditsBalance): {
  allowance: number;
  purchased: number;
} {
  const purchased = creditsFromMicros(balance.paidMicros);
  return { allowance: balance.credits - purchased, purchased };
}

// Pre-load placeholder. The app defaults new profiles to premium, so base the
// transient placeholder on the premium allowance; refreshBalance() replaces it
// with the authoritative tier-derived value immediately after mount.
export const EMPTY_BALANCE: CreditsBalance = {
  availableMicros: PREMIUM_MONTHLY_MICROS,
  paidMicros: 0,
  freeRemainingMicros: PREMIUM_MONTHLY_MICROS,
  credits: creditsFromMicros(PREMIUM_MONTHLY_MICROS),
  estMessagesLeft: estMessagesLeft(PREMIUM_MONTHLY_MICROS),
  lowBalance: PREMIUM_MONTHLY_MICROS < LOW_THRESHOLD,
  exhausted: false,
};
