import type { WorkoutProgram, FutureWorkout, WorkoutTemplate } from '@/types/workout';
import { format } from 'date-fns';

export interface ScheduledWorkoutResult {
  template: WorkoutTemplate | null;
  isRestDay: boolean;
  futureWorkout: FutureWorkout | null;
}

/**
 * Single source of truth for "what is scheduled on a given date".
 *
 * Priority:
 *  1. FutureWorkout entries for the active program (authoritative after
 *     push-backs, reschedules, or manual edits)
 *  2. Day-of-week fallback using program.days[], only when no FutureWorkout
 *     rows exist for the program yet
 *
 * All call sites (Dashboard, StartWorkoutScreen, calendar, etc.) must use
 * this function so every view shows the same label for the same date.
 */
export function getScheduledWorkoutForDate(
  date: Date | string,
  activeProgram: WorkoutProgram | null,
  futureWorkouts: FutureWorkout[],
  templates: WorkoutTemplate[],
): ScheduledWorkoutResult {
  const empty: ScheduledWorkoutResult = { template: null, isRestDay: false, futureWorkout: null };
  if (!activeProgram) return empty;

  const dateStr = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
  const hasProgramFutureWorkouts = futureWorkouts.some(f => f.programId === activeProgram.id);

  if (hasProgramFutureWorkouts) {
    const fw = futureWorkouts.find(
      f => f.programId === activeProgram.id && f.date === dateStr,
    );
    if (!fw) return empty;
    if (fw.templateId === 'rest') return { template: null, isRestDay: true, futureWorkout: fw };
    return {
      template: templates.find(t => t.id === fw.templateId) ?? null,
      isRestDay: false,
      futureWorkout: fw,
    };
  }

  // Fallback: day-of-week lookup in program.days[]
  const dow =
    typeof date === 'string'
      ? new Date(date + 'T00:00:00').getDay()
      : date.getDay();
  const programDay = activeProgram.days[(dow + 6) % 7];
  if (!programDay) return empty;
  if (programDay.templateId === 'rest') return { template: null, isRestDay: true, futureWorkout: null };
  return {
    template: templates.find(t => t.id === programDay.templateId) ?? null,
    isRestDay: false,
    futureWorkout: null,
  };
}
