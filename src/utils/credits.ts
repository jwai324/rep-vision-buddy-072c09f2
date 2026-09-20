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
