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
  lastUnmounted = null;
}

/** Drop every conversation held about one client (their link has ended). */
export function forgetClientThreads(clientId: string): void {
  for (const key of [...threads.keys()]) {
    if (key.endsWith(`:${clientId}`)) threads.delete(key);
  }
}

// The thread key of the provider that unmounted last. A provider that mounts
// again under the same key was not switched away from — it was reset (the
// app's crash screen remounts it), and handing it back the state it crashed
// with would undo the reset. Only a return from another account restores.
let lastUnmounted: string | null = null;

export function noteThreadUnmounted(key: string | null): void {
  lastUnmounted = key;
}

const INTERRUPTED_REPLY = 'This reply was interrupted.';

export function restoredThread(key: string | null): ChatThread {
  const saved = key && key !== lastUnmounted ? threads.get(key) : undefined;
  if (!saved) return { messages: [], proposals: {}, proposalIdsByMessage: {} };
  // An apply that was in flight when the provider unmounted resolved into a
  // component that no longer existed; its card would stay disabled forever.
  const proposals = Object.fromEntries(
    Object.entries(saved.proposals).map(([id, p]) => [id, p.status === 'applying' ? { ...p, status: 'pending' as const } : p]),
  );
  // Likewise a reply that was still streaming: the unmount aborted it and
  // nothing finished it. Left as it was it shows a typing indicator forever,
  // and an empty one is sent back as an empty assistant turn, which the
  // Messages API refuses — on every later send, until the chat is cleared.
  // Kept rather than dropped, because proposal cards may be keyed to it.
  const messages = saved.messages.map(m => (
    m.isLoading ? { ...m, isLoading: false, content: m.content || INTERRUPTED_REPLY } : m
  ));
  return { ...saved, messages, proposals };
}
