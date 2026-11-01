import { describe, it, expect, beforeEach } from 'vitest';
import {
  threads, restoredThread, noteThreadUnmounted, forgetChatThreads, forgetClientThreads,
} from '@/utils/chatThreads';
import type { ChatMessage } from '@/contexts/ChatContext';

const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: 'm', role: 'assistant', content: '', ...over }) as ChatMessage;

describe('restoredThread', () => {
  beforeEach(() => forgetChatThreads());

  it('settles a reply the unmount interrupted instead of restoring it mid-stream', () => {
    threads.set('coach:alice', {
      messages: [
        msg({ id: 'u', role: 'user', content: 'hi' }),
        msg({ id: 'a1', content: '', isLoading: true }),
        msg({ id: 'a2', content: 'Half a', isLoading: true }),
      ],
      proposals: {},
      proposalIdsByMessage: { a1: ['p1'] },
    });
    noteThreadUnmounted('coach:self');

    const { messages, proposalIdsByMessage } = restoredThread('coach:alice');
    expect(messages.map(m => [m.content, !!m.isLoading])).toEqual([
      ['hi', false],
      ['This reply was interrupted.', false],
      ['Half a', false],
    ]);
    // Kept, not dropped: a proposal card may be keyed to it.
    expect(proposalIdsByMessage).toEqual({ a1: ['p1'] });
  });

  it('does not restore into the provider that just unmounted under the same key', () => {
    threads.set('coach:alice', { messages: [msg({ content: 'x' })], proposals: {}, proposalIdsByMessage: {} });
    noteThreadUnmounted('coach:alice');
    expect(restoredThread('coach:alice').messages).toEqual([]);
  });

  it('forgets every conversation about one client, and only that client', () => {
    const empty = { messages: [], proposals: {}, proposalIdsByMessage: {} };
    threads.set('coach-1:alice', empty);
    threads.set('coach-2:alice', empty);
    threads.set('coach-1:bob', empty);
    forgetClientThreads('alice');
    expect([...threads.keys()]).toEqual(['coach-1:bob']);
  });
});
