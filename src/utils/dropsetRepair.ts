import type { WorkoutSet } from '@/types/workout';

/**
 * Repair a flat saved WorkoutSet[] that may have been corrupted by an old bug
 * where parent sets were serialized as `type: 'dropset'`.
 *
 * Rule: walk the array; whenever we see a `dropset` row that has no preceding
 * non-dropset parent for its `setNumber`, treat the FIRST orphaned dropset row
 * of each setNumber as the parent and coerce its type back to `'normal'`.
 *
 * This is a non-destructive, display/edit-time repair — stored data is not changed.
 */
export function repairFlatSets(sets: WorkoutSet[]): WorkoutSet[] {
  // Track which setNumbers already have a non-dropset parent in the output.
  const seenParentForSetNumber = new Set<number>();
  // Pre-scan: which setNumbers already have a real (non-dropset) parent?
  for (const s of sets) {
    if (s.type !== 'dropset') seenParentForSetNumber.add(s.setNumber);
  }

  const claimedAsParent = new Set<number>();
  return sets.map(s => {
    if (s.type !== 'dropset') return s;
    // If this setNumber never had a real parent, promote the first such dropset.
    if (!seenParentForSetNumber.has(s.setNumber) && !claimedAsParent.has(s.setNumber)) {
      claimedAsParent.add(s.setNumber);
      return { ...s, type: 'normal' as const };
    }
    return s;
  });
}
