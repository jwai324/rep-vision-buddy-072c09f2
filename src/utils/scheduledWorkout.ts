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

export interface SessionOrigin {
  /** The template the session was started from, when there is one. */
  templateId?: string | null;
  /** The template library, for matching a session with no known template by what it logged. */
  templates?: WorkoutTemplate[];
}

/**
 * Which scheduled entries a saved session marks as done.
 *
 * Logging a session never removes what was scheduled — the entry stays on the
 * calendar (and stays startable) and is only flagged `completed`. A rest-day
 * session only matches scheduled rest days, and a workout session only matches
 * scheduled workouts, so logging one kind never marks the other as done.
 *
 * One workout completes one scheduled workout. A program can put two on the
 * same day, and finishing one of them must not flag both, so among the day's
 * outstanding entries the session marks:
 *  - the entry for the template it was started from, when it has one;
 *  - nothing, when that template's entry is already done — that is a repeat
 *    of a finished workout, not the other one on the day;
 *  - otherwise the entry whose template shares the most exercises with what
 *    was logged, the first scheduled winning a tie. This covers a blank
 *    workout, a re-performed history entry, or a substituted template: the
 *    day's plan still counts as done, as it always did.
 */
export function getFutureWorkoutsCompletedBySession(
  session: { date: string; isRestDay?: boolean; exercises?: { exerciseId: string }[] },
  futureWorkouts: FutureWorkout[],
  origin: SessionOrigin = {},
): FutureWorkout[] {
  const sessionDateStr = format(parseLocalDate(session.date), 'yyyy-MM-dd');
  const wantsRest = session.isRestDay === true;
  const onDay = futureWorkouts.filter(fw => {
    if (format(parseLocalDate(fw.date), 'yyyy-MM-dd') !== sessionDateStr) return false;
    return wantsRest ? fw.templateId === 'rest' : fw.templateId !== 'rest';
  });
  const outstanding = onDay.filter(fw => !fw.completed);
  if (wantsRest || outstanding.length === 0) return outstanding;

  if (origin.templateId) {
    const own = outstanding.find(fw => fw.templateId === origin.templateId);
    if (own) return [own];
    if (onDay.some(fw => fw.templateId === origin.templateId)) return [];
  }

  const logged = new Set((session.exercises ?? []).map(e => e.exerciseId));
  const templatesById = new Map((origin.templates ?? []).map(t => [t.id, t]));
  let best = outstanding[0];
  let bestOverlap = -1;
  for (const fw of outstanding) {
    const template = templatesById.get(fw.templateId);
    const overlap = template ? template.exercises.filter(e => logged.has(e.exerciseId)).length : 0;
    if (overlap > bestOverlap) { best = fw; bestOverlap = overlap; }
  }
  return [best];
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
