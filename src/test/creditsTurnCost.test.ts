import { describe, it, expect } from 'vitest';
import {
  AVG_TURN_MICROS,
  RESERVE_MICROS,
  LOW_THRESHOLD,
  FREE_MONTHLY_MICROS,
  PREMIUM_MONTHLY_MICROS,
  deriveBalance,
  estMessagesLeft,
  currentPeriodUTC,
  EMPTY_BALANCE,
} from '@/utils/credits';
import * as server from '../../supabase/functions/_shared/pricing';

// The rate card in supabase/functions/_shared/pricing.ts, in micro-dollars per
// TOKEN, and the size of the cached prefix. Re-derived here so a rate or prompt
// change that invalidates the two constants fails a test rather than silently
// making the "messages left" figure a fiction again.
const RATE = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
// CLAUDE.md's "~23,000 tokens" is stale: the exercise library is not in
// VOLATILE_CONTEXT_KEYS, so it sits inside the cached block. Measuring the
// block (~97 KB of dense JSON) and back-solving the ledger's cache-write rounds
// both land at 36,000-45,000 tokens; 40,000 is the middle. See pricing.ts.
const CACHED_PREFIX_TOKENS = 40_000;

const firstRoundCacheHit =
  CACHED_PREFIX_TOKENS * RATE.cacheRead + 2_000 * RATE.input + 700 * RATE.output;
const firstRoundCacheWrite =
  CACHED_PREFIX_TOKENS * RATE.cacheWrite + 2_000 * RATE.input + 700 * RATE.output;
const extraRound =
  CACHED_PREFIX_TOKENS * RATE.cacheRead + 1_000 * RATE.input + 500 * RATE.output;

// MAX_ASSISTANT_ROUNDS is 3 in ChatContext; rounds 2-3 hit the warm cache.
const warmThreeRoundTurn = firstRoundCacheHit + 2 * extraRound;
const coldThreeRoundTurn = firstRoundCacheWrite + 2 * extraRound;

describe('the per-turn cost arithmetic the constants are derived from', () => {
  it('matches the figures written into pricing.ts', () => {
    expect(firstRoundCacheHit).toBe(47_500);
    expect(firstRoundCacheWrite).toBe(277_500);
    expect(extraRound).toBe(37_500);
    expect(warmThreeRoundTurn).toBe(122_500);
    expect(coldThreeRoundTurn).toBe(352_500);
  });
});

describe('AVG_TURN_MICROS (display) and RESERVE_MICROS (gate)', () => {
  it('are two distinct constants — they had the same value and different jobs', () => {
    expect(AVG_TURN_MICROS).not.toBe(RESERVE_MICROS);
  });

  it('puts the display average between a cache-hit turn and a cache-write turn', () => {
    // Honest, not flattering: above the cheapest real turn, below the cold one.
    expect(AVG_TURN_MICROS).toBeGreaterThan(firstRoundCacheHit);
    expect(AVG_TURN_MICROS).toBeLessThan(firstRoundCacheWrite);
    // And above the ~36k median of the (3x-deflated) cache-hit ledger cluster.
    expect(AVG_TURN_MICROS).toBeGreaterThan(36_000);
    expect(AVG_TURN_MICROS).toBe(110_000);
  });

  it('sizes the reserve to cover a common turn without stranding the allowance', () => {
    // Covers the cheapest real turn outright...
    expect(RESERVE_MICROS).toBeGreaterThan(firstRoundCacheHit);
    // ...but is not sized at the worst case, which would make nearly half a
    // free month unspendable.
    expect(RESERVE_MICROS).toBeLessThan(coldThreeRoundTurn);
    // At most roughly a fifth of the free allowance is held back.
    expect(RESERVE_MICROS).toBeLessThanOrEqual(FREE_MONTHLY_MICROS / 5);
    expect(RESERVE_MICROS).toBe(100_000);
  });

  it('keeps the low-balance warning at about two turns', () => {
    expect(LOW_THRESHOLD).toBe(220_000);
  });
});

describe('the client mirror and the authoritative server constants', () => {
  it('agree, because the gate and the estimate would otherwise disagree', () => {
    expect(AVG_TURN_MICROS).toBe(server.AVG_TURN_MICROS);
    expect(RESERVE_MICROS).toBe(server.RESERVE_MICROS);
    expect(FREE_MONTHLY_MICROS).toBe(server.FREE_MONTHLY_MICROS);
    expect(PREMIUM_MONTHLY_MICROS).toBe(server.PREMIUM_MONTHLY_MICROS);
  });

  it('prices a modelled turn at the figure the constants were derived from', () => {
    const hit = server.costMicros(
      {
        input_tokens: 2_000,
        output_tokens: 700,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: CACHED_PREFIX_TOKENS,
      },
      'claude-opus-4-7',
    );
    const write = server.costMicros(
      {
        input_tokens: 2_000,
        output_tokens: 700,
        cache_creation_input_tokens: CACHED_PREFIX_TOKENS,
        cache_read_input_tokens: 0,
      },
      'claude-opus-4-7',
    );
    expect(hit).toBe(firstRoundCacheHit);
    expect(write).toBe(firstRoundCacheWrite);
  });
});

const row = (freeUsed: number, paid = 0) => ({
  paid_balance_micros: paid,
  free_used_micros: freeUsed,
  free_period: currentPeriodUTC(),
});

describe('"messages left" for a full balance', () => {
  it('reads 4 for a full free month', () => {
    // 500,000 / 110,000 = 4.5. It read 10 when a turn was assumed to cost 50k.
    expect(deriveBalance(row(0), 'free').estMessagesLeft).toBe(4);
  });

  it('reads 63 for a full premium month', () => {
    // 7,000,000 / 110,000 = 63.6. It read 140 before.
    expect(deriveBalance(row(0), 'premium').estMessagesLeft).toBe(63);
    expect(EMPTY_BALANCE.estMessagesLeft).toBe(63);
  });

  it('counts purchased credits alongside the monthly allowance', () => {
    expect(deriveBalance(row(FREE_MONTHLY_MICROS, 800_000), 'free').estMessagesLeft).toBe(7);
  });
});

describe('the estimate never promises a turn the gate would refuse', () => {
  it('reads 0 below the reserve and at least 1 at or above it', () => {
    // 80,000 is most of an average turn but under the 100,000 reserve, so the
    // gate refuses it; 100,000 clears the gate even though it is less than the
    // 110,000 blended average, so the estimate must not round it down to 0.
    expect(estMessagesLeft(80_000)).toBe(0);
    expect(estMessagesLeft(RESERVE_MICROS - 1)).toBe(0);
    expect(estMessagesLeft(RESERVE_MICROS)).toBe(1);
    expect(estMessagesLeft(AVG_TURN_MICROS)).toBe(1);
  });

  it('never shows messages left on a balance the screen calls exhausted', () => {
    for (const available of [0, 1, 50_000, 79_999, 80_000, 99_999, 100_000, 500_000]) {
      const b = deriveBalance(row(Math.max(0, FREE_MONTHLY_MICROS - available)), 'free');
      expect(b.availableMicros).toBe(available);
      if (b.exhausted) expect(b.estMessagesLeft).toBe(0);
      else expect(b.estMessagesLeft).toBeGreaterThan(0);
    }
  });
});
