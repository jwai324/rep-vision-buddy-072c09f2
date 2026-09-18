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
  lockedUntil: 0,
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

  it('renders, and opens, when the browser blocks site storage', () => {
    // Chrome with site data blocked throws on the localStorage getter itself;
    // jsdom's does not, so the closest stand-in is a Storage that throws.
    const blocked = () => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    };
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const wasOpen = chatValue.isOpen;
    chatValue.isOpen = false;
    try {
      render(<AIChatBubble />);
      fireEvent.click(screen.getByRole('button'));
      expect(chatValue.setOpen).toHaveBeenCalledWith(true);
    } finally {
      chatValue.isOpen = wasOpen;
      getItem.mockRestore();
      setItem.mockRestore();
    }
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
