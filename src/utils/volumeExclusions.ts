import type { ExerciseLog, WorkoutSession } from '@/types/workout';

/**
 * Rehab, mobility and isometric-hold work distorts volume charts: a set of
 * wrist isos reads the same as a set of squats in the weekly set count, and
 * its (usually light) load drags the volume line around. A custom exercise
 * can be flagged to stay out of those aggregates while still being logged,
 * charted per-exercise, and counted toward the workout itself.
 *
 * The flag is applied at read time, never baked into stored session totals,
 * so flipping it re-scores history in both directions.
 */
export function volumeExcludedIds(
  customExercises: readonly { id: string; excludeFromVolume?: boolean }[],
): Set<string> {
  const ids = new Set<string>();
  for (const ex of customExercises) {
    if (ex.excludeFromVolume) ids.add(ex.id);
  }
  return ids;
}

export function isVolumeExcluded(exerciseId: string, excluded: ReadonlySet<string>): boolean {
  return excluded.has(exerciseId);
}

export function countedExercises<T extends { exerciseId: string }>(
  exercises: readonly T[],
  excluded: ReadonlySet<string>,
): T[] {
  if (excluded.size === 0) return exercises as T[];
  return exercises.filter(ex => !excluded.has(ex.exerciseId));
}

/**
 * What the excluded exercises contributed to a session's stored totals.
 * `totalVolume` / `totalSets` / `totalReps` are frozen at save time and count
 * every set including warmups, so subtracting from them has to use the same
 * rule or the corrected numbers drift away from the raw ones.
 */
export function excludedSessionTotals(
  session: Pick<WorkoutSession, 'exercises'>,
  excluded: ReadonlySet<string>,
): { volume: number; sets: number; reps: number } {
  const totals = { volume: 0, sets: 0, reps: 0 };
  if (excluded.size === 0) return totals;
  for (const ex of session.exercises as ExerciseLog[]) {
    if (!excluded.has(ex.exerciseId)) continue;
    for (const set of ex.sets) {
      totals.volume += set.reps * (set.weight ?? 0);
      totals.sets += 1;
      totals.reps += set.reps;
    }
  }
  return totals;
}

/** A session's stored totals with the excluded exercises taken back out. */
export function countedSessionTotals(
  session: Pick<WorkoutSession, 'exercises' | 'totalVolume' | 'totalSets' | 'totalReps'>,
  excluded: ReadonlySet<string>,
): { volume: number; sets: number; reps: number } {
  const dropped = excludedSessionTotals(session, excluded);
  return {
    volume: Math.max(0, session.totalVolume - dropped.volume),
    sets: Math.max(0, session.totalSets - dropped.sets),
    reps: Math.max(0, session.totalReps - dropped.reps),
  };
}
