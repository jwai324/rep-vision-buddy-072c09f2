import { useMemo } from 'react';
import { EXERCISES } from '@/types/workout';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';

/**
 * Returns a merged lookup mapping exercise IDs to names,
 * combining both built-in and user-created custom exercises.
 */
export function useExerciseLookup(): Record<string, string> {
  const { exercises: customExercises } = useCustomExercisesContext();

  return useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const [id, ex] of Object.entries(EXERCISES)) {
      lookup[id] = ex.name;
    }
    for (const ce of customExercises) {
      lookup[ce.id] = ce.name;
    }
    return lookup;
  }, [customExercises]);
}
