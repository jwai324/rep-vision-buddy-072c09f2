/**
 * Every localStorage key that holds something belonging to the signed-in
 * user rather than to the device. None of them is namespaced by user id, so
 * all of them have to be cleared on sign-out — the next account on a shared
 * phone otherwise resumes the previous user's half-finished workout (and can
 * save it into its own history), and inherits their unsent drafts.
 *
 * The account-scoped snapshot (`storageCache`) and the pending-template queue
 * are keyed by user and clear themselves; this covers the rest. A new draft
 * key added anywhere in the app belongs in this list.
 */
export const ACTIVE_SESSION_CACHE_KEY = 'active-session-cache';

export const USER_DRAFT_KEYS = [
  ACTIVE_SESSION_CACHE_KEY,
  'ai-chat-input-draft',
  'ai_program_builder_draft',
  'program_builder_draft',
  'template_builder_draft',
  'error-report-draft',
] as const;

export function clearLocalDrafts(): void {
  for (const key of USER_DRAFT_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable (private mode, blocked) — nothing to clear.
    }
  }
}
