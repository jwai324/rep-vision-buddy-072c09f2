/**
 * Display-name repair for anything that carries a snapshotted `exerciseName`.
 *
 * Session blocks and saved logs store the exercise name alongside its id, but
 * that name is captured the moment the row is created. Built-in exercises are
 * bundled with the app, so they always resolve; custom exercises arrive from
 * Supabase after mount, and a row created in that window fell back to the raw
 * `custom-<uuid>` id — which then rode along into the session cache, the saved
 * log, and every screen that reads the log back.
 *
 * The id is always right, so resolve names from the live library at read time
 * and treat the stored one as a fallback. An id the library doesn't know (a
 * deleted custom exercise) keeps whatever name it was saved with.
 */

/** Live name for an id, falling back to the one stored on the row. */
export function resolveExerciseName(
  lookup: Record<string, string>,
  exerciseId: string,
  storedName: string,
): string {
  return lookup[exerciseId] ?? storedName;
}

/**
 * Re-resolve the names on a list of session blocks. Returns the original array
 * reference when nothing changed, so this can drive a setState without
 * churning a render on every lookup change.
 */
export function repairBlockNames<T extends { exerciseId: string; exerciseName: string }>(
  blocks: T[],
  lookup: Record<string, string>,
): T[] {
  let changed = false;
  const next = blocks.map(b => {
    const resolved = lookup[b.exerciseId];
    if (!resolved || resolved === b.exerciseName) return b;
    changed = true;
    return { ...b, exerciseName: resolved };
  });
  return changed ? next : blocks;
}
