// A DST transition makes two consecutive local midnights 23 or 25 hours apart.
// The zone has to be pinned before date-fns is imported, because the whole test
// turns on what "local" means; vitest pins none of its own.
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import { getLongestDailyStreak } from '@/utils/streak';
import type { WorkoutSession } from '@/types/workout';

const days = (dates: string[]): WorkoutSession[] => dates.map((date, i) => ({
  id: `s${i}`, date, exercises: [], duration: 1800,
  totalVolume: 100, totalSets: 3, totalReps: 30,
}));

describe('longest daily streak across daylight saving', () => {
  it('counts a run that spans the spring-forward night', () => {
    // 2026-03-08 is the US spring-forward Sunday: 2026-03-07T00:00 to
    // 2026-03-08T00:00 is 23 hours, so an exact-24h test broke the run here.
    expect(getLongestDailyStreak(days([
      '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09',
    ]))).toBe(4);
  });

  it('counts a run that spans the fall-back night', () => {
    // 2026-11-01, the 25-hour night.
    expect(getLongestDailyStreak(days([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]))).toBe(4);
  });

  it('still breaks a run on a genuinely missed day', () => {
    expect(getLongestDailyStreak(days([
      '2026-03-06', '2026-03-07', '2026-03-09', '2026-03-10',
    ]))).toBe(2);
  });

  it('counts duplicate days once', () => {
    expect(getLongestDailyStreak(days([
      '2026-03-07', '2026-03-07', '2026-03-08',
    ]))).toBe(2);
  });
});
