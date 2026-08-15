import type { WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import type { UserPreferences, UserProfile, BodyMeasurement } from '@/hooks/useStorage';

/**
 * Last-known-good snapshot of the user's data, so a returning app can paint
 * real content immediately instead of a spinner while Supabase is re-queried
 * in the background.
 *
 * Everything here is a cache, never a source of truth: a miss, a corrupt
 * payload, or a full disk all degrade to "load from the network as before".
 */
export interface CachedStorage {
  history: WorkoutSession[];
  templates: WorkoutTemplate[];
  programs: WorkoutProgram[];
  activeProgramId: string | null;
  futureWorkouts: FutureWorkout[];
  preferences: UserPreferences;
  profile: UserProfile;
  bodyMeasurements: BodyMeasurement[];
}

const KEY_PREFIX = 'repvision:storage:';
// Bump when CachedStorage changes shape. Old keys are swept on the next write.
const CACHE_VERSION = 1;

/**
 * Sessions are by far the biggest slice and localStorage writes are
 * synchronous, so cache a recent window rather than the full 500 the network
 * load fetches. The rest arrives a moment later when revalidation lands.
 */
const MAX_CACHED_SESSIONS = 200;

/** Skip the write rather than risk a QuotaExceededError on a big history. */
const MAX_CACHE_BYTES = 2_000_000;

const keyFor = (userId: string) => `${KEY_PREFIX}v${CACHE_VERSION}:${userId}`;

/**
 * Drop every cache entry that isn't the one we're about to write — stale
 * versions, and snapshots belonging to other accounts on a shared device.
 */
function sweepOtherKeys(keep: string | null) {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX) && k !== keep) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing to sweep */ }
}

export function readStorageCache(userId: string): CachedStorage | null {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Guard against a half-written or hand-edited payload: a missing array
    // here would surface as a crash deep inside a screen rather than a miss.
    if (!parsed || !Array.isArray(parsed.history) || !Array.isArray(parsed.templates)) return null;
    return parsed as CachedStorage;
  } catch {
    return null;
  }
}

export function writeStorageCache(userId: string, data: CachedStorage): void {
  const key = keyFor(userId);
  try {
    const payload = JSON.stringify({
      ...data,
      history: data.history.slice(0, MAX_CACHED_SESSIONS),
    });
    if (payload.length > MAX_CACHE_BYTES) {
      // Too big to be worth the main-thread cost; leave whatever is there and
      // let the next load come off the network.
      return;
    }
    sweepOtherKeys(key);
    localStorage.setItem(key, payload);
  } catch {
    // Quota, private mode, or storage disabled. Drop the entry so we never
    // serve a partial snapshot on the next open.
    try { localStorage.removeItem(key); } catch { /* nothing else to do */ }
  }
}

/** Called on sign-out so the next account on this device starts clean. */
export function clearStorageCache(): void {
  sweepOtherKeys(null);
}
