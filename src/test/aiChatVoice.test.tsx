import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EMPTY_BALANCE } from '@/utils/credits';
import type { SpeechRecognizer } from '@/utils/dictationEngine';

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

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

import { AIChatBubble } from '@/components/AIChatBubble';

class FakeRecognizer implements SpeechRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: SpeechRecognizer['onstart'] = null;
  onend: SpeechRecognizer['onend'] = null;
  onerror: SpeechRecognizer['onerror'] = null;
  onresult: SpeechRecognizer['onresult'] = null;

  start() {
    this.onstart?.(new Event('start'));
  }
  stop() {
    this.onend?.(new Event('end'));
  }
  abort() {
    /* nothing to release in a fake */
  }

  speak(phrases: { text: string; final: boolean }[]) {
    const results = phrases.map(phrase => ({
      0: { transcript: phrase.text },
      length: 1,
      isFinal: phrase.final,
    }));
    act(() => {
      this.onresult?.({ results: Object.assign(results, { length: results.length }) as never });
    });
  }

  fail(error: string) {
    act(() => {
      this.onerror?.({ error });
    });
  }
}

let recognizers: FakeRecognizer[] = [];
const mic = () => recognizers[recognizers.length - 1];
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;

function startDictating() {
  fireEvent.click(screen.getByLabelText('Start voice input'));
}

beforeEach(() => {
  localStorage.clear();
  chatValue.isOpen = true;
  sendMessage.mockClear();
  toastError.mockClear();
  recognizers = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function () {
    const recognizer = new FakeRecognizer();
    recognizers.push(recognizer);
    return recognizer;
  };
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('AI coach voice input', () => {
  it('offers no mic on a browser without speech recognition', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<AIChatBubble />);
    expect(screen.queryByLabelText('Start voice input')).toBeNull();
  });

  it('writes what is said into the message box, previewing the phrase in flight', () => {
    render(<AIChatBubble />);
    startDictating();

    mic().speak([{ text: 'add three sets of squats', final: false }]);
    expect(box()).toHaveValue('add three sets of squats');

    mic().speak([{ text: 'add three sets of squats', final: true }]);
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('speaks after what was already typed', () => {
    render(<AIChatBubble />);
    fireEvent.change(box(), { target: { value: 'for tomorrow' } });
    startDictating();
    mic().speak([{ text: 'add squats', final: true }]);

    expect(box()).toHaveValue('for tomorrow add squats');
  });

  it('sends the dictated message and does not let a replayed phrase come back', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add three sets of squats', final: true }]);
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('add three sets of squats');
    expect(box()).toHaveValue('');

    // The browser keeps replaying the session's results; the sent phrase is
    // spoken for, so only the new one may land.
    mic().speak([
      { text: 'add three sets of squats', final: true },
      { text: 'and a plank', final: true },
    ]);
    expect(box()).toHaveValue('and a plank');
  });

  it('does not re-add a phrase that was still in flight when it was sent', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add three sets of squats', final: false }]);
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('add three sets of squats');
    expect(box()).toHaveValue('');

    // That phrase finalizes after the send; its words have already gone.
    mic().speak([{ text: 'add three sets of squats', final: true }]);
    expect(box()).toHaveValue('');

    mic().speak([
      { text: 'add three sets of squats', final: true },
      { text: 'and a plank', final: true },
    ]);
    expect(box()).toHaveValue('and a plank');
  });

  it('keeps dictating after a send, so a follow-up needs no second tap', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add squats', final: true }]);
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(screen.getByLabelText('Stop voice input')).toBeTruthy();
  });

  it('banks what was said as an ordinary draft once the mic is switched off', () => {
    const first = render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add three sets of squats', final: true }]);
    fireEvent.click(screen.getByLabelText('Stop voice input'));

    expect(box()).toHaveValue('add three sets of squats');

    first.unmount();
    render(<AIChatBubble />);
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('treats an edit as the new baseline instead of replaying over it', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add three sets of squats', final: true }]);

    fireEvent.change(box(), { target: { value: 'add four sets of squats' } });
    mic().speak([
      { text: 'add three sets of squats', final: true },
      { text: 'and a plank', final: true },
    ]);

    expect(box()).toHaveValue('add four sets of squats and a plank');
  });

  it('releases the microphone when the panel is dismissed', () => {
    const { rerender } = render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add squats', final: true }]);

    chatValue.isOpen = false;
    rerender(<AIChatBubble />);
    chatValue.isOpen = true;
    rerender(<AIChatBubble />);

    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
    expect(box()).toHaveValue('add squats');
  });

  it('explains a blocked microphone instead of failing silently', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().fail('not-allowed');

    expect(toastError).toHaveBeenCalledWith(
      'Microphone access is blocked. Allow it in your browser settings to dictate.',
    );
    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
  });

  it('keeps what was already said when the microphone drops out', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'add three sets', final: true }]);
    mic().fail('network');

    expect(box()).toHaveValue('add three sets');
    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
  });

  it('holds dictation to the message length limit', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speak([{ text: 'squat '.repeat(120).trim(), final: true }]);

    expect(box().value.length).toBe(500);
  });
});
