import { ACTIVE_SESSION_CACHE_KEY as CACHE_KEY, FINISHED_WORKOUT_KEY } from '@/utils/localDrafts';
import { releaseRestSchedule } from '@/utils/restTimerScheduler';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { WorkoutSession } from '@/types/workout';

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

/**
 * Hand the workout in progress to another account. Used only when its owner
 * can no longer be reached (a client ended the link mid-workout) and the coach
 * chooses to keep it in their own history rather than lose it.
 */
export function setSessionCacheOwner(ownerUserId: string): boolean {
  const cache = getSessionCache();
  if (!cache) return false;
  try {
    // Detached from the template it was started from: that template belongs
    // to the previous owner, and naming it here would offer to update, or
    // tick off, something this account does not have.
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, ownerUserId, templateId: null, templateSnapshot: null }));
    return true;
  } catch {
    return false;
  }
}

// Fired synchronously, before the key is removed, so a still-mounted
// ActiveSession can cancel its own pending debounced write. Without this, a
// write scheduled just before Save/Cancel/Discard clears the cache can still
// fire moments later — on its own 500ms clock, independent of this call —
// and resurrect the very entry that was just cleared, which is what made a
// workout finished and saved the day before still look "in progress" on the
// next cold load.
export const SESSION_CACHE_CLEARING_EVENT = 'repvision:session-cache-clearing';

export function clearSessionCache() {
  window.dispatchEvent(new Event(SESSION_CACHE_CLEARING_EVENT));
  localStorage.removeItem(CACHE_KEY);
  // Its auto-save goes with it: every path that ends a workout (save,
  // discard, start-new) comes through here, so none can leave a deadline
  // behind that later saves a workout the user threw away.
  setFinishedWorkout(null);
  // The workout is over, so is its rest: the scheduler outlives the session
  // screen on purpose (a minimized session keeps its rest), and this is the one
  // signal that the session it belonged to is gone.
  releaseRestSchedule();
}

/** How long the Workout Complete screen waits for a choice before saving. */
export const FINISHED_AUTO_SAVE_MS = 10 * 60 * 1000;

/**
 * A workout that reached the Workout Complete screen and has not been saved,
 * continued or discarded yet, with the moment it saves itself.
 *
 * Persisted rather than held in a timer because a timer does not survive what
 * the deadline has to: a phone that locks freezes the page, and a page frozen
 * long enough is discarded. The deadline is a timestamp, so whichever comes
 * first — the timer, the tab becoming visible again, or the next cold load —
 * sees it has passed and saves. The session itself was fixed at Finish
 * (date, start time, duration), so a save that lands late writes the same row.
 */
export interface FinishedWorkout {
  session: WorkoutSession;
  templateId?: string;
  autoSaveAt: number;
}

/**
 * The pending finished workout, or null. A record whose session cache is gone
 * is stale — the workout it belonged to has ended by some path — and is
 * dropped here, so it can never save a workout the user discarded.
 */
export function getFinishedWorkout(): FinishedWorkout | null {
  try {
    const raw = localStorage.getItem(FINISHED_WORKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FinishedWorkout> | null;
    const valid = !!parsed
      && typeof parsed.autoSaveAt === 'number'
      && typeof parsed.session?.id === 'string'
      && localStorage.getItem(CACHE_KEY) !== null;
    if (!valid) {
      localStorage.removeItem(FINISHED_WORKOUT_KEY);
      return null;
    }
    return parsed as FinishedWorkout;
  } catch {
    return null;
  }
}

export function setFinishedWorkout(finished: FinishedWorkout | null): void {
  try {
    if (finished) localStorage.setItem(FINISHED_WORKOUT_KEY, JSON.stringify(finished));
    else localStorage.removeItem(FINISHED_WORKOUT_KEY);
  } catch {
    // Storage unavailable: the in-memory timer still runs for this page load.
  }
}
