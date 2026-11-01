import type { ChatMessage, Proposal } from '@/contexts/ChatContext';

/**
 * State that must outlive a remount of the provider. `Index` is remounted
 * whenever a coach switches between their own account and a client's, which
 * would otherwise reset both of these.
 *
 * The lockout belongs to the person holding the phone (it guards their own
 * metered access), so it is keyed by the signed-in user: were it reset by a
 * switch, switching would be a one-tap way around it — the same reason
 * clearChat leaves it alone. It lasts for the page load, as it always has.
 *
 * Each account's conversation is kept separately, keyed by signed-in user and
 * owner, so a coach's thread about one client never shows under another and
 * comes back when they return. In memory only, like the chat itself has always
 * been; sign-out drops it (`forgetChatThreads`).
 */
export interface LockoutState { consecutiveErrors: number; lockedUntil: number }
export const lockouts = new Map<string, LockoutState>();

export interface ChatThread {
  messages: ChatMessage[];
  proposals: Record<string, Proposal>;
  proposalIdsByMessage: Record<string, string[]>;
}
export const threads = new Map<string, ChatThread>();

export function forgetChatThreads(): void {
  threads.clear();
  lockouts.clear();
}

export function restoredThread(key: string | null): ChatThread {
  const saved = key ? threads.get(key) : undefined;
  if (!saved) return { messages: [], proposals: {}, proposalIdsByMessage: {} };
  // An apply that was in flight when the provider unmounted resolved into a
  // component that no longer existed; its card would stay disabled forever.
  const proposals = Object.fromEntries(
    Object.entries(saved.proposals).map(([id, p]) => [id, p.status === 'applying' ? { ...p, status: 'pending' as const } : p]),
  );
  return { ...saved, proposals };
}
