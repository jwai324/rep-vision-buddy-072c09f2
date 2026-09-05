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
 * Resolve the superset links a template's exercises carry.
 *
 * An explicit `supersetGroup` is the source of truth and is kept as is.
 * Exercises that only carry `setType: 'superset'` — older templates, and
 * anything the AI coach or program builder wrote, since neither ever set a
 * group id — are linked by adjacency: each run of two or more consecutive
 * superset-typed exercises without a group becomes one new group, numbered
 * above any group the template already has. A lone superset-typed exercise
 * links to nothing, so it comes back as a plain one.
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
      const group = nextGroup++;
      for (const r of run) resolved.push({ ...r, supersetGroup: group });
    } else {
      resolved.push({ ...ex, setType: 'normal' });
    }
    changed = true;
    i = end + 1;
  }

  return changed ? resolved : exercises;
}
