import { addDays, addWeeks, format, startOfWeek } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';
import type { WorkoutSession } from '@/types/workout';

export type StreakMode = 'daily' | 'weekly';

/** Daily streak: consecutive days with ANY session (workout or rest). Today skipped if empty. */
export function getDailyStreak(sessions: WorkoutSession[]): number {
  if (sessions.length === 0) return 0;
  const dates = new Set(sessions.map(s => format(parseLocalDate(s.date), 'yyyy-MM-dd')));
  const today = format(new Date(), 'yyyy-MM-dd');
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = addDays(new Date(today + 'T00:00:00'), -i);
    const ds = format(d, 'yyyy-MM-dd');
    if (dates.has(ds)) streak++;
    else if (i > 0) break;
    else continue;
  }
  return streak;
}

/** Longest run of consecutive days with ANY session. */
export function getLongestDailyStreak(sessions: WorkoutSession[]): number {
  if (sessions.length === 0) return 0;
  const dates = Array.from(new Set(sessions.map(s => format(parseLocalDate(s.date), 'yyyy-MM-dd')))).sort();
  let longest = 1, temp = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T00:00:00').getTime();
    const cur = new Date(dates[i] + 'T00:00:00').getTime();
    if ((cur - prev) / 86400000 === 1) { temp++; longest = Math.max(longest, temp); }
    else temp = 1;
  }
  return longest;
}

/** Workout count per Mon-Sun week (rest days excluded). Map key = yyyy-MM-dd of week's Monday. */
function workoutsPerWeek(sessions: WorkoutSession[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) {
    if (s.isRestDay) continue;
    const d = parseLocalDate(s.date);
    const wk = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    map.set(wk, (map.get(wk) || 0) + 1);
  }
  return map;
}

/** Weekly streak: consecutive completed weeks (Mon-Sun) where workout count >= target.
 *  Current week: counts +1 if met, otherwise doesn't break the streak. */
export function getWeeklyStreak(sessions: WorkoutSession[], target: number): number {
  if (target <= 0) return 0;
  const counts = workoutsPerWeek(sessions);
  const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  let streak = 0;
  // Current week
  const thisKey = format(thisWeekStart, 'yyyy-MM-dd');
  if ((counts.get(thisKey) || 0) >= target) streak++;
  // Walk back
  for (let i = 1; i < 260; i++) {
    const wk = format(addWeeks(thisWeekStart, -i), 'yyyy-MM-dd');
    if ((counts.get(wk) || 0) >= target) streak++;
    else break;
  }
  return streak;
}

/** Longest run of consecutive past weeks (excluding incomplete current week unless met) hitting target. */
export function getLongestWeeklyStreak(sessions: WorkoutSession[], target: number): number {
  if (target <= 0) return 0;
  const counts = workoutsPerWeek(sessions);
  if (counts.size === 0) return 0;
  const keys = Array.from(counts.keys()).sort();
  const earliest = new Date(keys[0] + 'T00:00:00');
  const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  let cursor = startOfWeek(earliest, { weekStartsOn: 1 });
  let longest = 0, temp = 0;
  while (cursor <= thisWeekStart) {
    const k = format(cursor, 'yyyy-MM-dd');
    if ((counts.get(k) || 0) >= target) { temp++; longest = Math.max(longest, temp); }
    else temp = 0;
    cursor = addWeeks(cursor, 1);
  }
  return longest;
}

export function getCurrentStreak(sessions: WorkoutSession[], mode: StreakMode, target: number): number {
  return mode === 'weekly' ? getWeeklyStreak(sessions, target) : getDailyStreak(sessions);
}

export function getLongestStreak(sessions: WorkoutSession[], mode: StreakMode, target: number): number {
  return mode === 'weekly' ? getLongestWeeklyStreak(sessions, target) : getLongestDailyStreak(sessions);
}

/**
 * Adjust the raw current streak by an offset that was locked in when the
 * user last changed streak_mode or streak_weekly_target, so a settings edit
 * doesn't visibly change the streak indicator. The offset survives as long
 * as the new mode's raw streak is still >0. Once the raw streak breaks
 * (raw === 0) AND at least one period has elapsed since the offset was set,
 * the offset should be cleared — `shouldClearAdjustment` signals that.
 *
 * The one-period grace window matters right after a mode change: switching
 * from daily to weekly on a mid-week day can leave raw = 0 for weekly (this
 * week hasn't met the target yet), and we don't want to clear the offset
 * before the new mode has had any chance to produce a positive raw value.
 */
export function computeDisplayedStreak(
  sessions: WorkoutSession[],
  mode: StreakMode,
  target: number,
  adjustment: number,
  adjustmentSetAt: string | null,
  today: Date = new Date(),
): { displayed: number; shouldClearAdjustment: boolean } {
  const raw = getCurrentStreak(sessions, mode, target);
  if (adjustment === 0 || !adjustmentSetAt) {
    return { displayed: raw, shouldClearAdjustment: false };
  }

  if (raw > 0) {
    return { displayed: Math.max(0, raw + adjustment), shouldClearAdjustment: false };
  }

  const setAt = parseLocalDate(adjustmentSetAt);
  const todayStart = new Date(format(today, 'yyyy-MM-dd') + 'T00:00:00');
  const periodElapsed = mode === 'daily'
    ? todayStart.getTime() - setAt.getTime() >= 2 * 86400000
    : startOfWeek(todayStart, { weekStartsOn: 1 }).getTime()
        > startOfWeek(setAt, { weekStartsOn: 1 }).getTime();

  if (periodElapsed) {
    return { displayed: 0, shouldClearAdjustment: true };
  }
  return { displayed: Math.max(0, adjustment), shouldClearAdjustment: false };
}
