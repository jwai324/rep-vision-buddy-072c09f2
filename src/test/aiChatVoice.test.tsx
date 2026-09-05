import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EMPTY_BALANCE } from '@/utils/credits';
import type { SpeechRecognizer } from '@/utils/dictation';

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

/** Chrome's recognizer: one cumulative result list per session, replayed whole. */
class FakeRecognizer implements SpeechRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: SpeechRecognizer['onstart'] = null;
  onend: SpeechRecognizer['onend'] = null;
  onerror: SpeechRecognizer['onerror'] = null;
  onresult: SpeechRecognizer['onresult'] = null;

  private results: { text: string; final: boolean }[] = [];

  start() {
    this.onstart?.(new Event('start'));
  }
  stop() {
    this.onend?.(new Event('end'));
  }
  abort() {
    /* nothing to release in a fake */
  }

  /** The browser closing the session on its own silence timeout. */
  timeOut() {
    act(() => {
      this.onend?.(new Event('end'));
    });
  }

  speaking(text: string) {
    this.write(text, false);
  }
  said(text: string) {
    this.write(text, true);
  }
  replay() {
    act(() => this.report());
  }

  fail(error: string) {
    act(() => {
      this.onerror?.({ error });
    });
  }

  private write(text: string, final: boolean) {
    const open = this.results.length - 1;
    if (open >= 0 && !this.results[open].final) this.results[open] = { text, final };
    else this.results.push({ text, final });
    act(() => this.report());
  }

  private report() {
    const results = this.results.map(result => ({
      0: { transcript: result.text },
      length: 1,
      isFinal: result.final,
    }));
    this.onresult?.({ results: Object.assign(results, { length: results.length }) as never });
  }
}

let recognizers: FakeRecognizer[] = [];
const mic = () => recognizers[recognizers.length - 1];
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const startDictating = () => fireEvent.click(screen.getByLabelText('Start voice input'));

beforeEach(() => {
  localStorage.clear();
  chatValue.isOpen = true;
  chatValue.isLoading = false;
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

    mic().speaking('add three sets of');
    expect(box()).toHaveValue('add three sets of');

    mic().said('add three sets of squats');
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('speaks after what was already typed', () => {
    render(<AIChatBubble />);
    fireEvent.change(box(), { target: { value: 'for tomorrow' } });
    startDictating();
    mic().said('add squats');

    expect(box()).toHaveValue('for tomorrow add squats');
  });

  it('writes a sentence once, however often the browser replays it', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets');
    mic().replay();
    mic().said('of squats');
    mic().replay();

    expect(box()).toHaveValue('add three sets of squats');
  });

  it('banks what was said and releases the mic when the browser ends the session', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets of squats');

    // Browsers close the session on their own silence timeout, and the run ends
    // with it rather than reopening one behind the user's back.
    mic().timeOut();

    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('keeps the phrase in flight when the browser ends the session under it', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets');
    mic().speaking('of squats');
    mic().timeOut();

    expect(box()).toHaveValue('add three sets of squats');
  });

  it('carries a second run on after the words already in the box', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets');
    mic().timeOut();

    startDictating();
    mic().said('of squats');
    mic().replay();

    expect(box()).toHaveValue('add three sets of squats');
  });

  it('sends the dictated message and does not let a replayed phrase come back', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets of squats');
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('add three sets of squats');
    expect(box()).toHaveValue('');

    mic().replay();
    mic().said('and a plank');
    expect(box()).toHaveValue('and a plank');
  });

  it('does not re-add a phrase that was still in flight when it was sent', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().speaking('add three sets of squats');
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('add three sets of squats');
    expect(box()).toHaveValue('');

    // That phrase finalizes after the send; its words have already gone.
    mic().said('add three sets of squats');
    expect(box()).toHaveValue('');

    mic().said('and a plank');
    expect(box()).toHaveValue('and a plank');
  });

  it('keeps dictating after a send, so a follow-up needs no second tap', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add squats');
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(screen.getByLabelText('Stop voice input')).toBeTruthy();
  });

  it('can switch the microphone off while a reply is still streaming', () => {
    const { rerender } = render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets of squats');
    fireEvent.click(screen.getByLabelText('Send message'));

    chatValue.isLoading = true;
    rerender(<AIChatBubble />);
    fireEvent.click(screen.getByLabelText('Stop voice input'));

    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
  });

  it('banks what was said as an ordinary draft once the mic is switched off', () => {
    const first = render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets of squats');
    fireEvent.click(screen.getByLabelText('Stop voice input'));

    expect(box()).toHaveValue('add three sets of squats');

    first.unmount();
    render(<AIChatBubble />);
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('starts a second run from what is in the box, not from the first run', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add squats');
    fireEvent.click(screen.getByLabelText('Stop voice input'));

    startDictating();
    mic().said('and lunges');
    expect(box()).toHaveValue('add squats and lunges');
  });

  it('treats an edit as the new baseline instead of replaying over it', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('add three sets of squats');

    fireEvent.change(box(), { target: { value: 'add four sets of squats' } });
    mic().replay();
    mic().said('and a plank');

    expect(box()).toHaveValue('add four sets of squats and a plank');
  });

  it('releases the microphone when the panel is dismissed', () => {
    const { rerender } = render(<AIChatBubble />);
    startDictating();
    mic().said('add squats');

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
    mic().said('add three sets');
    mic().fail('network');

    expect(box()).toHaveValue('add three sets');
    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
  });

  it('holds dictation to the message length limit', () => {
    render(<AIChatBubble />);
    startDictating();
    mic().said('squat '.repeat(120).trim());

    expect(box().value.length).toBe(500);
  });
});
