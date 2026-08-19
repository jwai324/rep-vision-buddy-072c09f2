import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EMPTY_BALANCE } from '@/utils/credits';
import type { SpeechRecognitionLike } from '@/hooks/useSpeechRecognition';

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

// Enough of the browser class for the mic button to appear and for us to hand
// the hook a finished phrase.
class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: SpeechRecognitionLike['onstart'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onresult: SpeechRecognitionLike['onresult'] = null;
  start() { this.onstart?.call(this, new Event('start')); }
  stop() { this.onend?.call(this, new Event('end')); }
  abort() {}
  // A session's result list is cumulative, so each phrase arrives alongside
  // the ones before it.
  private phrases: string[] = [];
  saySomething(transcript: string) {
    this.phrases.push(transcript);
    const results = this.phrases.map(text => {
      const result = [{ transcript: text }] as unknown as Record<string, unknown>;
      Object.defineProperty(result, 'length', { value: 1 });
      Object.defineProperty(result, 'isFinal', { value: true });
      return result;
    }) as unknown as { length: number };
    Object.defineProperty(results, 'length', { value: this.phrases.length });
    this.onresult?.call(this, { resultIndex: this.phrases.length - 1, results } as never);
  }
}

let latest: FakeRecognition | null = null;

beforeEach(() => {
  localStorage.clear();
  sendMessage.mockClear();
  latest = null;
  // A factory rather than a subclass: `new` on a function that returns an
  // object hands back that object, and it keeps the instance grabbable.
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function () {
    latest = new FakeRecognition();
    return latest;
  };
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.useRealTimers();
});

import { AIChatBubble } from '@/components/AIChatBubble';

const dictate = (phrase: string) => {
  fireEvent.click(screen.getByLabelText('Start dictation'));
  act(() => latest!.saySomething(phrase));
};

describe('chat dictation ending', () => {
  it('leaves the dictated words in the box when it stops on its own', () => {
    vi.useFakeTimers();
    render(<AIChatBubble />);

    dictate('add three sets of squats');
    expect(screen.getByLabelText('Stop dictation')).toBeInTheDocument();

    // Long enough that the speaker is done rather than mid-thought.
    act(() => { vi.advanceTimersByTime(8100); });

    expect(screen.getByLabelText('Start dictation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask anything…')).toHaveValue('add three sets of squats');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps listening while the speaker is only pausing', () => {
    vi.useFakeTimers();
    render(<AIChatBubble />);

    dictate('add three sets');
    act(() => { vi.advanceTimersByTime(6000); });
    act(() => latest!.saySomething('of squats'));
    act(() => { vi.advanceTimersByTime(6000); });

    expect(screen.getByLabelText('Stop dictation')).toBeInTheDocument();
    // The placeholder reads "Listening…" while the mic is open, so the box is
    // found by role here rather than by placeholder.
    expect(screen.getByRole('textbox')).toHaveValue('add three sets of squats');
  });

  it('ends dictation when the message is sent', () => {
    render(<AIChatBubble />);

    dictate('build me a push day');
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('build me a push day');
    expect(screen.getByLabelText('Start dictation')).toBeInTheDocument();
  });
});
