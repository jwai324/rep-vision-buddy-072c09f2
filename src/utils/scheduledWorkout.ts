import type { WorkoutProgram, FutureWorkout, WorkoutTemplate } from '@/types/workout';
import { format } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';

export interface ScheduledWorkoutResult {
  template: WorkoutTemplate | null;
  isRestDay: boolean;
  futureWorkout: FutureWorkout | null;
}

/**
 * Single source of truth for "what is scheduled on a given date".
 *
 * Returns every scheduled entry for the date (a program may schedule two
 * or more workouts on the same day). Priority:
 *  1. FutureWorkout rows for the active program (authoritative after
 *     push-backs, reschedules, or manual edits)
 *  2. Day-of-week fallback across program.days[] entries with a
 *     matching weekly frequency, used only when no FutureWorkout rows
 *     exist for the program yet
 */
export function getScheduledWorkoutsForDate(
  date: Date | string,
  activeProgram: WorkoutProgram | null,
  futureWorkouts: FutureWorkout[],
  templates: WorkoutTemplate[],
): ScheduledWorkoutResult[] {
  if (!activeProgram) return [];

  const dateStr = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
  const hasProgramFutureWorkouts = futureWorkouts.some(f => f.programId === activeProgram.id);

  if (hasProgramFutureWorkouts) {
    const fws = futureWorkouts.filter(
      f => f.programId === activeProgram.id && f.date === dateStr,
    );
    return fws.map(fw => {
      if (fw.templateId === 'rest') return { template: null, isRestDay: true, futureWorkout: fw };
      return {
        template: templates.find(t => t.id === fw.templateId) ?? null,
        isRestDay: false,
        futureWorkout: fw,
      };
    });
  }

  const dow =
    typeof date === 'string'
      ? new Date(date + 'T00:00:00').getDay()
      : date.getDay();
  const matchingDays = activeProgram.days.filter(
    d => d.frequency?.type === 'weekly' && d.frequency.weekday === dow,
  );
  return matchingDays.map(programDay => {
    if (programDay.templateId === 'rest') return { template: null, isRestDay: true, futureWorkout: null };
    return {
      template: templates.find(t => t.id === programDay.templateId) ?? null,
      isRestDay: false,
      futureWorkout: null,
    };
  });
}

/**
 * Which scheduled entries a saved session marks as done.
 *
 * Logging a session never removes what was scheduled — the entry stays on the
 * calendar (and stays startable) and is only flagged `completed`. A rest-day
 * session only matches scheduled rest days, and a workout session only matches
 * scheduled workouts, so logging one kind never marks the other as done.
 */
export function getFutureWorkoutsCompletedBySession(
  session: { date: string; isRestDay?: boolean },
  futureWorkouts: FutureWorkout[],
): FutureWorkout[] {
  const sessionDateStr = format(parseLocalDate(session.date), 'yyyy-MM-dd');
  const wantsRest = session.isRestDay === true;
  return futureWorkouts.filter(fw => {
    if (fw.completed) return false;
    if (format(parseLocalDate(fw.date), 'yyyy-MM-dd') !== sessionDateStr) return false;
    return wantsRest ? fw.templateId === 'rest' : fw.templateId !== 'rest';
  });
}

/**
 * Legacy single-result helper. Returns the first scheduled entry for the
 * date, or an empty result. New callers should use
 * `getScheduledWorkoutsForDate` and render every returned entry.
 */
export function getScheduledWorkoutForDate(
  date: Date | string,
  activeProgram: WorkoutProgram | null,
  futureWorkouts: FutureWorkout[],
  templates: WorkoutTemplate[],
): ScheduledWorkoutResult {
  const empty: ScheduledWorkoutResult = { template: null, isRestDay: false, futureWorkout: null };
  const results = getScheduledWorkoutsForDate(date, activeProgram, futureWorkouts, templates);
  return results[0] ?? empty;
}
