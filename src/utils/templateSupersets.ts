import type { SetType } from '@/types/workout';

interface SupersetCarrier {
  setType: SetType;
  supersetGroup?: number;
}

/**
 * The set type an exercise should carry given whether it is linked into a
 * superset. A link is expressed by `supersetGroup`; `setType: 'superset'` is
 * only the echo of that link, so a linked exercise with nothing more specific
 * to say reports 'superset', and an unlinked one never does.
 */
export function linkedSetType(setType: SetType, linked: boolean): SetType {
  if (linked) return setType === 'normal' || setType === 'superset' ? 'superset' : setType;
  return setType === 'superset' ? 'normal' : setType;
}

/**
 * How a run of set-type-only supersets is cut into groups.
 *
 * A run is what the AI coach and the program generator write when they mean
 * "pair these up": a stretch of consecutive exercises all typed 'superset'
 * with no group id. Treating the whole run as one group is what the first
 * version did, and it turns a seven-exercise session into a single block of
 * one colour — the opposite of showing the pairing. Real runs come in twos
 * (A1/A2, B1/B2), so the run is cut into pairs.
 *
 * An odd run ends in a trio rather than a stray: the author typed every one of
 * them 'superset', so each is meant to be linked to something, and there is
 * nothing after the last pair for a leftover to link to.
 */
function groupSizes(runLength: number): number[] {
  const sizes: number[] = [];
  let left = runLength;
  while (left >= 2) {
    const size = left === 3 ? 3 : 2;
    sizes.push(size);
    left -= size;
  }
  return sizes;
}

/**
 * Clear a `supersetGroup` that only one exercise holds. A superset is a link
 * between two or more; a group of one is left behind when a partner is dropped
 * — skipped in a workout that then updates its template, or deleted in the
 * builder — and nothing else ever heals it.
 */
export function withoutLoneSupersets<T extends SupersetCarrier>(exercises: T[]): T[] {
  const counts = new Map<number, number>();
  for (const e of exercises) {
    if (e.supersetGroup !== undefined) counts.set(e.supersetGroup, (counts.get(e.supersetGroup) ?? 0) + 1);
  }
  let changed = false;
  const cleared = exercises.map(e => {
    if (e.supersetGroup === undefined || counts.get(e.supersetGroup)! > 1) return e;
    changed = true;
    return { ...e, supersetGroup: undefined, setType: linkedSetType(e.setType, false) };
  });
  return changed ? cleared : exercises;
}

/**
 * Bring each superset's members next to each other, anchored where the group
 * first appears, leaving everything else in place. The linker lets any two
 * exercises be picked, and a drag can step one out from between its partners;
 * either way the shared tint stops reading as a link once the members are not
 * adjacent. Order is what a superset means on the floor, so the list is what
 * moves.
 */
export function groupAdjacentSupersets<T extends SupersetCarrier>(exercises: T[]): T[] {
  const taken = new Set<number>();
  const ordered: T[] = [];
  exercises.forEach((ex, i) => {
    if (taken.has(i)) return;
    taken.add(i);
    ordered.push(ex);
    if (ex.supersetGroup === undefined) return;
    exercises.forEach((other, j) => {
      if (j <= i || taken.has(j) || other.supersetGroup !== ex.supersetGroup) return;
      taken.add(j);
      ordered.push(other);
    });
  });
  return ordered.some((ex, i) => ex !== exercises[i]) ? ordered : exercises;
}

/**
 * Resolve the superset links a template's exercises carry.
 *
 * An explicit `supersetGroup` is the source of truth and is kept as is, except
 * that a group only one exercise holds is not a link at all and is cleared.
 * Exercises that only carry `setType: 'superset'` — older templates, and
 * anything the AI coach or program builder wrote before those tools could
 * express a group — are linked by adjacency: each run of two or more
 * consecutive superset-typed exercises without a group is cut into pairs
 * (see `groupSizes`), numbered above any group the template already has. A
 * lone superset-typed exercise links to nothing, so it comes back as a plain
 * one.
 *
 * Returns the same array when nothing needed resolving.
 */
export function resolveTemplateSupersets<T extends SupersetCarrier>(exercises: T[]): T[] {
  const existing = exercises
    .map(e => e.supersetGroup)
    .filter((g): g is number => g !== undefined);
  let nextGroup = existing.length > 0 ? Math.max(...existing) + 1 : 1;

  const resolved: T[] = [];
  let changed = false;
  let i = 0;
  while (i < exercises.length) {
    const ex = exercises[i];
    const isLoose = ex.supersetGroup === undefined && ex.setType === 'superset';
    if (!isLoose) {
      const setType = linkedSetType(ex.setType, ex.supersetGroup !== undefined);
      if (setType !== ex.setType) { resolved.push({ ...ex, setType }); changed = true; }
      else resolved.push(ex);
      i += 1;
      continue;
    }

    let end = i;
    while (end + 1 < exercises.length
      && exercises[end + 1].supersetGroup === undefined
      && exercises[end + 1].setType === 'superset') {
      end += 1;
    }
    const run = exercises.slice(i, end + 1);
    if (run.length >= 2) {
      let taken = 0;
      for (const size of groupSizes(run.length)) {
        const group = nextGroup++;
        for (const r of run.slice(taken, taken + size)) resolved.push({ ...r, supersetGroup: group });
        taken += size;
      }
    } else {
      resolved.push({ ...ex, setType: 'normal' });
    }
    changed = true;
    i = end + 1;
  }

  return withoutLoneSupersets(changed ? resolved : exercises);
}
