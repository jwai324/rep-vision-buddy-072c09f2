// Client mirror of the DISPLAY-ONLY token constants. The server
// (supabase/functions/_shared/pricing.ts) is the authoritative source of truth
// for accounting; these must be kept in sync with it (documented coupling).

export const MICROS_PER_CREDIT = 1000; // 1 credit = $0.001
export const FREE_MONTHLY_MICROS = 500_000; // ~$0.50 / month
export const AVG_TURN_MICROS = 50_000; // rough cost of one turn, for estimates
export const RESERVE_MICROS = 50_000; // server pre-call gate threshold
export const LOW_THRESHOLD = 2 * AVG_TURN_MICROS;

export function currentPeriodUTC(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM, UTC
}

export function creditsFromMicros(micros: number): number {
  return Math.max(0, Math.floor(micros / MICROS_PER_CREDIT));
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
export function deriveBalance(row: {
  paid_balance_micros: number;
  free_used_micros: number;
  free_period: string;
} | null): CreditsBalance {
  const paid = row?.paid_balance_micros ?? 0;
  const freeUsed =
    !row || row.free_period !== currentPeriodUTC() ? 0 : row.free_used_micros;
  const freeRemaining = Math.max(0, FREE_MONTHLY_MICROS - freeUsed);
  const available = freeRemaining + paid;
  return {
    availableMicros: available,
    paidMicros: paid,
    freeRemainingMicros: freeRemaining,
    credits: creditsFromMicros(available),
    estMessagesLeft: Math.max(0, Math.floor(available / AVG_TURN_MICROS)),
    lowBalance: available < LOW_THRESHOLD,
    exhausted: available < RESERVE_MICROS,
  };
}

export const EMPTY_BALANCE: CreditsBalance = {
  availableMicros: FREE_MONTHLY_MICROS,
  paidMicros: 0,
  freeRemainingMicros: FREE_MONTHLY_MICROS,
  credits: creditsFromMicros(FREE_MONTHLY_MICROS),
  estMessagesLeft: Math.floor(FREE_MONTHLY_MICROS / AVG_TURN_MICROS),
  lowBalance: FREE_MONTHLY_MICROS < LOW_THRESHOLD,
  exhausted: false,
};
