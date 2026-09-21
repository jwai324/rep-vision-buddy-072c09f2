import { ACTIVE_SESSION_CACHE_KEY as CACHE_KEY } from '@/utils/localDrafts';
import { releaseRestSchedule } from '@/utils/restTimerScheduler';
import type { ActiveSessionCache } from '@/types/activeSession';

/**
 * The workout in progress, as it was last written.
 *
 * Which of the two copies is the workout is a rule, not a race. While the
 * `ActiveSession` screen is mounted it owns the workout and its debounced flush
 * is the only writer of this cache: the AI coach reaches the workout through the
 * session controller and deliberately does not touch the cache, whose next flush
 * would overwrite anything it wrote. The moment the screen unmounts — which is
 * what minimizing a workout does — the cache IS the workout, and the coach reads
 * and writes it directly, so a suggestion made before the minimize can still be
 * applied after it. The screen reads the result back the next time it mounts,
 * which is why the change is on screen after Resume. The other half of the rule
 * is "The workout with no screen on it" in ChatContext.
 */
export function getSessionCache(): ActiveSessionCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSessionCache() {
  localStorage.removeItem(CACHE_KEY);
  // The workout is over, so is its rest: the scheduler outlives the session
  // screen on purpose (a minimized session keeps its rest), and this is the one
  // signal that the session it belonged to is gone.
  releaseRestSchedule();
}
