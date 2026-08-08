import { describe, it, expect } from 'vitest';
import { addDays, format, subDays } from 'date-fns';
import { computeDisplayedStreak } from '@/utils/streak';
import type { WorkoutSession } from '@/types/workout';

// getCurrentStreak/getDailyStreak read `new Date()` internally and cannot
// take an injected "now", so the raw side of these tests always runs against
// the real current date. Anchor the test session dates to that same real
// today so both sides agree — otherwise the wall-clock at test time skews
// the raw streak away from what the fixture assumes.
const NOW = new Date();
const isoDay = (offsetDaysAgo: number): string => format(subDays(NOW, offsetDaysAgo), 'yyyy-MM-dd');

const session = (dateStr: string, isRestDay = false): WorkoutSession => ({
  id: dateStr,
  date: dateStr,
  exercises: [],
  duration: 0,
  totalVolume: 0,
  totalSets: 0,
  totalReps: 0,
  isRestDay,
});

describe('computeDisplayedStreak', () => {
  it('returns raw streak when no adjustment is set', () => {
    const sessions = [session(isoDay(0)), session(isoDay(1)), session(isoDay(2))];
    const { displayed, shouldClearAdjustment } = computeDisplayedStreak(
      sessions, 'daily', 3, 0, null,
    );
    expect(displayed).toBe(3);
    expect(shouldClearAdjustment).toBe(false);
  });

  it('adds the frozen offset while raw > 0', () => {
    // Daily streak of 3 today, adjustment of +4 (user was at 7 before mode change).
    const sessions = [session(isoDay(0)), session(isoDay(1)), session(isoDay(2))];
    const { displayed } = computeDisplayedStreak(
      sessions, 'daily', 3, 4, isoDay(2),
    );
    expect(displayed).toBe(7);
  });

  it('holds the frozen value while raw=0 during the grace window (daily)', () => {
    // User changed mode today, raw is 0 (no sessions at all).
    // On the same day, we should still show the frozen value.
    const sessions: WorkoutSession[] = [];
    const { displayed, shouldClearAdjustment } = computeDisplayedStreak(
      sessions, 'daily', 3, 5, isoDay(0),
    );
    expect(displayed).toBe(5);
    expect(shouldClearAdjustment).toBe(false);
  });

  it('clears the offset once raw=0 persists past the grace window (daily)', () => {
    // Adjustment set 3 days ago, still no workouts. Grace has expired.
    const sessions: WorkoutSession[] = [];
    const { displayed, shouldClearAdjustment } = computeDisplayedStreak(
      sessions, 'daily', 3, 5, isoDay(3),
    );
    expect(displayed).toBe(0);
    expect(shouldClearAdjustment).toBe(true);
  });

  it('clamps display at 0 when adjustment would drive it negative', () => {
    const sessions = [session(isoDay(0)), session(isoDay(1)), session(isoDay(2))];
    const { displayed } = computeDisplayedStreak(
      sessions, 'daily', 3, -5, isoDay(2),
    );
    expect(displayed).toBe(0);
  });

  it('preserves the value across the grace window and clears next week (weekly)', () => {
    // Weekly mode: adjustment set today, raw=0 (no sessions this week or last).
    // Same week → display frozen value, don't clear.
    let result = computeDisplayedStreak([], 'weekly', 3, 6, isoDay(0));
    expect(result.displayed).toBe(6);
    expect(result.shouldClearAdjustment).toBe(false);

    // Two weeks later (fake by simulating a future `today` param), the grace
    // window has expired.
    const twoWeeksLater = addDays(NOW, 14);
    result = computeDisplayedStreak([], 'weekly', 3, 6, isoDay(0), twoWeeksLater);
    expect(result.displayed).toBe(0);
    expect(result.shouldClearAdjustment).toBe(true);
  });
});
