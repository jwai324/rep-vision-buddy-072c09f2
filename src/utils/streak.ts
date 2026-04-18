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
