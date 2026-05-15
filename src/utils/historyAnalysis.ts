import { format, startOfWeek } from 'date-fns';
import type { WorkoutSession } from '@/types/workout';
import { parseLocalDate, formatLocalDate } from '@/utils/dateUtils';
import { getCurrentStreak, getLongestStreak, type StreakMode } from '@/utils/streak';

/** Monday-of-week ISO date for the given date. */
export function weekStart(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? parseLocalDate(dateInput) : dateInput;
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** Filter sessions to those whose date is within the last `days` days. Rest days excluded by default. */
export function sessionsInWindow(sessions: WorkoutSession[], days: number, includeRest = false): WorkoutSession[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = formatLocalDate(cutoff);
  return sessions.filter(s => s.date >= cutoffStr && (includeRest || !s.isRestDay));
}

export interface SessionRpePoint {
  date: string;
  avg_rpe: number;
  set_count: number;
}

/** Per-session average RPE across working sets (RPE > 0, type !== 'warmup'). */
export function rpePerSession(sessions: WorkoutSession[]): SessionRpePoint[] {
  return sessions
    .filter(s => !s.isRestDay)
    .map(s => {
      const rpes: number[] = [];
      for (const ex of s.exercises) {
        for (const set of ex.sets) {
          if (set.rpe != null && set.rpe > 0 && set.type !== 'warmup') rpes.push(set.rpe);
        }
      }
      if (rpes.length === 0) return null;
      return {
        date: s.date.substring(0, 10),
        avg_rpe: Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10,
        set_count: rpes.length,
      };
    })
    .filter((p): p is SessionRpePoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface WeeklyRpePoint {
  week_start: string;
  avg_rpe: number;
  set_count: number;
}

export interface WeeklyRpeTrend {
  weekly: WeeklyRpePoint[];
  overall_avg_rpe: number | null;
  total_sets: number;
}

function aggregateWeeklyRpe(sessions: WorkoutSession[], exerciseId?: string): WeeklyRpeTrend {
  const buckets = new Map<string, { sum: number; count: number }>();
  let totalSum = 0;
  let totalCount = 0;

  for (const s of sessions) {
    if (s.isRestDay) continue;
    const wk = weekStart(s.date);
    for (const ex of s.exercises) {
      if (exerciseId && ex.exerciseId !== exerciseId) continue;
      for (const set of ex.sets) {
        if (set.rpe == null || set.rpe <= 0 || set.type === 'warmup') continue;
        const b = buckets.get(wk) || { sum: 0, count: 0 };
        b.sum += set.rpe;
        b.count += 1;
        buckets.set(wk, b);
        totalSum += set.rpe;
        totalCount += 1;
      }
    }
  }

  const weekly: WeeklyRpePoint[] = Array.from(buckets.entries())
    .map(([week_start, { sum, count }]) => ({
      week_start,
      avg_rpe: Math.round((sum / count) * 10) / 10,
      set_count: count,
    }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  return {
    weekly,
    overall_avg_rpe: totalCount ? Math.round((totalSum / totalCount) * 10) / 10 : null,
    total_sets: totalCount,
  };
}

/** Weekly average RPE across all working sets in the window. */
export function weeklyRpeTrend(sessions: WorkoutSession[], days: number): WeeklyRpeTrend {
  return aggregateWeeklyRpe(sessionsInWindow(sessions, days));
}

/** Weekly average RPE for a specific exercise. */
export function exerciseRpeTrend(sessions: WorkoutSession[], exerciseId: string, days: number): WeeklyRpeTrend & { exercise_id: string } {
  return { exercise_id: exerciseId, ...aggregateWeeklyRpe(sessionsInWindow(sessions, days), exerciseId) };
}

export interface ExerciseProgressionPoint {
  date: string;
  top_weight: number | null;
  top_reps: number | null;
  top_rpe: number | null;
  total_volume: number;
  total_sets: number;
}

export interface ExerciseProgression {
  exercise_id: string;
  exercise_name: string;
  sessions: ExerciseProgressionPoint[];
}

/** Per-session top working set + total volume for a specific exercise. */
export function exerciseProgression(
  sessions: WorkoutSession[],
  exerciseId: string,
  exerciseName: string,
  days: number,
): ExerciseProgression {
  const points: ExerciseProgressionPoint[] = [];
  for (const s of sessionsInWindow(sessions, days)) {
    const ex = s.exercises.find(e => e.exerciseId === exerciseId);
    if (!ex) continue;
    const working = ex.sets.filter(set => set.type !== 'warmup');
    if (working.length === 0) continue;
    let topWeight: number | null = null;
    let topReps: number | null = null;
    let topRpe: number | null = null;
    let volume = 0;
    for (const set of working) {
      const w = set.weight ?? null;
      if (w != null && (topWeight == null || w > topWeight)) {
        topWeight = w;
        topReps = set.reps ?? null;
        topRpe = set.rpe ?? null;
      }
      if (w != null && set.reps != null) volume += w * set.reps;
    }
    points.push({
      date: s.date.substring(0, 10),
      top_weight: topWeight,
      top_reps: topReps,
      top_rpe: topRpe,
      total_volume: Math.round(volume),
      total_sets: working.length,
    });
  }
  return {
    exercise_id: exerciseId,
    exercise_name: exerciseName,
    sessions: points.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export interface WeeklyVolumePoint {
  week_start: string;
  volume: number;
  sets: number;
  top_weight: number | null;
}

export interface WeeklyVolume {
  exercise_id: string;
  exercise_name: string;
  weekly: WeeklyVolumePoint[];
}

/** Weekly volume + set count + top weight for a specific exercise. */
export function weeklyVolumeByExercise(
  sessions: WorkoutSession[],
  exerciseId: string,
  exerciseName: string,
  days: number,
): WeeklyVolume {
  const buckets = new Map<string, { volume: number; sets: number; top: number | null }>();
  for (const s of sessionsInWindow(sessions, days)) {
    const ex = s.exercises.find(e => e.exerciseId === exerciseId);
    if (!ex) continue;
    const wk = weekStart(s.date);
    const b = buckets.get(wk) || { volume: 0, sets: 0, top: null };
    for (const set of ex.sets) {
      if (set.type === 'warmup') continue;
      const w = set.weight ?? null;
      const r = set.reps ?? null;
      if (w != null && r != null) b.volume += w * r;
      b.sets += 1;
      if (w != null && (b.top == null || w > b.top)) b.top = w;
    }
    buckets.set(wk, b);
  }
  const weekly: WeeklyVolumePoint[] = Array.from(buckets.entries())
    .map(([week_start, { volume, sets, top }]) => ({ week_start, volume: Math.round(volume), sets, top_weight: top }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
  return { exercise_id: exerciseId, exercise_name: exerciseName, weekly };
}

export interface ConsistencyStats {
  workouts_per_week_avg: number;
  longest_streak: number;
  current_streak: number;
  streak_mode: StreakMode;
  training_days: number;
  rest_days: number;
  total_days: number;
  avg_duration_min: number;
}

/** Streak + training-vs-rest breakdown across the window. */
export function consistencyStats(
  sessions: WorkoutSession[],
  days: number,
  streakMode: StreakMode,
  streakTarget: number,
): ConsistencyStats {
  const windowed = sessionsInWindow(sessions, days, true);
  const training = windowed.filter(s => !s.isRestDay);
  const rest = windowed.filter(s => s.isRestDay);
  const weeks = days / 7;
  const totalDuration = training.reduce((sum, s) => sum + (s.duration || 0), 0);
  return {
    workouts_per_week_avg: weeks > 0 ? Math.round((training.length / weeks) * 10) / 10 : 0,
    longest_streak: getLongestStreak(sessions, streakMode, streakTarget),
    current_streak: getCurrentStreak(sessions, streakMode, streakTarget),
    streak_mode: streakMode,
    training_days: training.length,
    rest_days: rest.length,
    total_days: days,
    avg_duration_min: training.length > 0 ? Math.round(totalDuration / training.length / 60) : 0,
  };
}

export interface NotesSummary {
  workout_notes: { date: string; note: string }[];
  exercise_notes: { date: string; exercise_name: string; note: string }[];
}

/** Recent workout-level and exercise-level notes within the window. Caps each list. */
export function recentNotes(sessions: WorkoutSession[], days: number, cap = 20): NotesSummary {
  const workoutNotes: { date: string; note: string }[] = [];
  const exerciseNotes: { date: string; exercise_name: string; note: string }[] = [];
  for (const s of sessionsInWindow(sessions, days, true)) {
    if (s.note?.trim()) workoutNotes.push({ date: s.date.substring(0, 10), note: s.note.trim() });
    for (const ex of s.exercises) {
      if (ex.note?.trim()) {
        exerciseNotes.push({ date: s.date.substring(0, 10), exercise_name: ex.exerciseName, note: ex.note.trim() });
      }
    }
  }
  workoutNotes.sort((a, b) => b.date.localeCompare(a.date));
  exerciseNotes.sort((a, b) => b.date.localeCompare(a.date));
  return { workout_notes: workoutNotes.slice(0, cap), exercise_notes: exerciseNotes.slice(0, cap) };
}

export interface RecoverySummary {
  rest_days: number;
  activities: { date: string; activity_id: string; duration_min?: number; notes?: string }[];
}

/** Rest days and recovery activities logged within the window. */
export function recoverySummary(sessions: WorkoutSession[], days: number): RecoverySummary {
  const windowed = sessionsInWindow(sessions, days, true);
  const rest = windowed.filter(s => s.isRestDay);
  const activities: RecoverySummary['activities'] = [];
  for (const s of windowed) {
    for (const a of s.recoveryActivities || []) {
      activities.push({
        date: s.date.substring(0, 10),
        activity_id: a.activityId,
        duration_min: a.duration,
        notes: a.notes,
      });
    }
  }
  activities.sort((a, b) => b.date.localeCompare(a.date));
  return { rest_days: rest.length, activities };
}
