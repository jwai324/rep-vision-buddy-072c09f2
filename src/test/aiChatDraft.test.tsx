import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EMPTY_BALANCE } from '@/utils/credits';

const sendMessage = vi.fn();

const chatValue = {
  messages: [] as unknown[],
  isOpen: true,
  isLoading: false,
  setOpen: vi.fn(),
  sendMessage,
  clearChat: vi.fn(),
  quickChips: [] as string[],
  creditsBalance: { ...EMPTY_BALANCE, credits: 1000, estMessagesLeft: 50 },
  godMode: false,
  consecutiveErrors: 0,
  cooldownActive: false,
  proposals: {},
  proposalIdsByMessage: {},
  applyProposal: vi.fn(),
  discardProposal: vi.fn(),
};

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => chatValue,
  GOD_MODE_PHRASE: 'god mode',
}));

import { AIChatBubble } from '@/components/AIChatBubble';

describe('AI coach chat draft', () => {
  beforeEach(() => {
    localStorage.clear();
    sendMessage.mockClear();
  });

  it('keeps an unsent message in the box across unmount and remount', () => {
    const first = render(<AIChatBubble />);
    fireEvent.change(screen.getByPlaceholderText('Ask anything…'), {
      target: { value: 'how should I program deadlifts' },
    });

    first.unmount();
    render(<AIChatBubble />);

    expect(screen.getByPlaceholderText('Ask anything…')).toHaveValue('how should I program deadlifts');
  });

  it('clears the stored draft once the message is sent', () => {
    const first = render(<AIChatBubble />);
    fireEvent.change(screen.getByPlaceholderText('Ask anything…'), {
      target: { value: 'build me a push day' },
    });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(sendMessage).toHaveBeenCalledWith('build me a push day');

    first.unmount();
    render(<AIChatBubble />);

    expect(screen.getByPlaceholderText('Ask anything…')).toHaveValue('');
  });
});
