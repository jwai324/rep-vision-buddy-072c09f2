/**
 * Every localStorage key that holds something belonging to the signed-in
 * user rather than to the device. All of them have to be cleared on sign-out
 * — the next account on a shared phone otherwise resumes the previous user's
 * half-finished workout (and can save it into its own history), and inherits
 * their unsent drafts.
 *
 * The account-scoped snapshot (`storageCache`) and the pending-template queue
 * are keyed by user and clear themselves; this covers the rest. A new draft
 * key added anywhere in the app belongs in this list.
 *
 * A coach acting as a client keeps the client's drafts apart from their own
 * under `<key>:<clientId>` (`ownerDraftKey`), so a half-written template or
 * message never follows them into another account. Those are swept with
 * their base key.
 */
export const ACTIVE_SESSION_CACHE_KEY = 'active-session-cache';
export const FINISHED_WORKOUT_KEY = 'finished-workout-pending';

export const AI_CHAT_DRAFT_KEY = 'ai-chat-input-draft';
export const AI_PROGRAM_BUILDER_DRAFT_KEY = 'ai_program_builder_draft';
export const PROGRAM_BUILDER_DRAFT_KEY = 'program_builder_draft';
export const TEMPLATE_BUILDER_DRAFT_KEY = 'template_builder_draft';

/** The coach context's own keys (the identity a coach last acted as). */
export const COACH_STORAGE_PREFIX = 'repvision:coach:';

export const USER_DRAFT_KEYS = [
  ACTIVE_SESSION_CACHE_KEY,
  FINISHED_WORKOUT_KEY,
  AI_CHAT_DRAFT_KEY,
  AI_PROGRAM_BUILDER_DRAFT_KEY,
  PROGRAM_BUILDER_DRAFT_KEY,
  TEMPLATE_BUILDER_DRAFT_KEY,
  'error-report-draft',
] as const;

/**
 * The key a draft is kept under for the account on screen: the base key for
 * the signed-in user's own (unchanged, so existing drafts survive), and
 * `<key>:<clientId>` while a coach acts as a client.
 */
export function ownerDraftKey(base: string, actingClientId: string | null | undefined): string {
  return actingClientId ? `${base}:${actingClientId}` : base;
}

export function clearLocalDrafts(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const owned = k.startsWith(COACH_STORAGE_PREFIX)
        || USER_DRAFT_KEYS.some(base => k === base || k.startsWith(`${base}:`));
      if (owned) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch {
    // Storage unavailable (private mode, blocked) — nothing to clear.
  }
}
