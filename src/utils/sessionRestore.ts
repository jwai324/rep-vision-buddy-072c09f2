import type { ActiveSessionCache } from '@/types/activeSession';
import type { ExerciseId } from '@/types/workout';

export interface RestoredSessionScreen {
  type: 'activeSession';
  exercises: ExerciseId[];
  templateId?: string;
}

/**
 * The screen to reopen for a workout that survived a cold reload.
 *
 * Everything the session needs to redraw itself — blocks, name, timers — comes
 * out of the cache once ActiveSession mounts, so the screen carries no
 * exercises. It does have to carry the template id, though: that is what the
 * finish flow looks the template up by, and a session resumed without it
 * finishes silently instead of offering to save the changes back.
 */
export function restoredSessionScreen(cache: ActiveSessionCache | null): RestoredSessionScreen | null {
  if (!cache) return null;
  return {
    type: 'activeSession',
    exercises: [],
    ...(cache.templateId ? { templateId: cache.templateId } : {}),
  };
}
