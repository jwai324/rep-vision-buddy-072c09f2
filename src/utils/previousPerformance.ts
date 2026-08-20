import type { WorkoutSession, ExerciseId } from '@/types/workout';

export interface PreviousSet {
  weight?: number;
  reps: number;
  rpe?: number;
  time?: number;
}

export interface PreviousPerformance {
  /** Date of the session these sets came from ('yyyy-MM-dd'), or null if none. */
  date: string | null;
  /** One entry per working set of that session, in order. */
  sets: PreviousSet[];
}

const EMPTY: PreviousPerformance = { date: null, sets: [] };

const day = (session: WorkoutSession) => session.date.substring(0, 10);

/**
 * The sets a "Previous" column lines up against, one per working set.
 *
 * Warmups are out because the column sits beside working sets only. Dropsets
 * are out because they are saved as extra rows sharing their parent's set
 * number, while the live table nests them inside the parent — counting them
 * would shift every later row onto the wrong set.
 */
function workingSets(sets: WorkoutSession['exercises'][number]['sets']): PreviousSet[] {
  return sets
    .filter(s => s.type !== 'warmup' && s.type !== 'dropset')
    .map(s => ({ weight: s.weight, reps: s.reps, rpe: s.rpe, time: s.time }));
}

/**
 * The last time this exercise was actually worked, and what was logged for it.
 *
 * Picked by date rather than by position in `history`: a session logged for an
 * earlier day (a backfill, or a workout edited after the fact) lands at the
 * front of the list, and taking the first match would show those numbers as
 * "previous" ahead of a genuinely more recent session.
 */
export function findPreviousPerformance(
  history: readonly WorkoutSession[],
  exerciseId: ExerciseId,
): PreviousPerformance {
  let best: WorkoutSession | null = null;
  let bestSets: PreviousSet[] = [];

  for (const session of history) {
    if (session.isRestDay) continue;
    const log = session.exercises.find(e => e.exerciseId === exerciseId);
    if (!log) continue;
    const sets = workingSets(log.sets);
    // A session where the exercise was only warmed up says nothing about the
    // working weight, so keep looking further back.
    if (sets.length === 0) continue;
    if (!best || isNewer(session, best)) {
      best = session;
      bestSets = sets;
    }
  }

  if (!best) return EMPTY;
  return { date: day(best), sets: bestSets };
}

// Same day twice falls back to start time, then to list order — history comes
// back newest-first, so the first of two otherwise-equal sessions wins.
function isNewer(candidate: WorkoutSession, current: WorkoutSession): boolean {
  const a = day(candidate);
  const b = day(current);
  if (a !== b) return a > b;
  if (candidate.startedAt && current.startedAt) return candidate.startedAt > current.startedAt;
  return false;
}
