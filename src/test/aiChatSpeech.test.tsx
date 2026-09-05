import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EMPTY_BALANCE } from '@/utils/credits';
import { FINALIZE_GRACE_MS, RESTART_DELAY_MS, SILENCE_TIMEOUT_MS } from '@/utils/speechToText';
import {
  type FakeSpeechRecognition,
  installFakeSpeechRecognition,
  uninstallFakeSpeechRecognition,
} from './helpers/fakeSpeechRecognition';

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

let recognizers: FakeSpeechRecognition[] = [];
const mic = () => recognizers[recognizers.length - 1];
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const tapMic = () => fireEvent.click(screen.getByLabelText('Start voice input'));
const tapStop = () => fireEvent.click(screen.getByLabelText('Stop voice input'));
const micIsOff = () => screen.getByLabelText('Start voice input');
const micIsOn = () => screen.getByLabelText('Stop voice input');

/** Browser events reach React from outside its own handlers, hence `act`. */
const browser = {
  interim: (text: string) => act(() => mic().interim(text)),
  final: (text: string) => act(() => mic().final(text)),
  replay: () => act(() => mic().replay()),
  duplicateFinal: () => act(() => mic().duplicateFinal()),
  error: (code: string) => act(() => mic().error(code)),
  /** The session ending on its own after enough time to have been real. */
  endSession: () =>
    act(() => {
      vi.advanceTimersByTime(800);
      mic().end();
      vi.advanceTimersByTime(RESTART_DELAY_MS);
    }),
  /** The browser giving up after hearing nothing in a chained session. */
  silence: () =>
    act(() => {
      vi.advanceTimersByTime(6000);
      mic().error('no-speech');
      mic().end();
    }),
  wait: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  localStorage.clear();
  chatValue.isOpen = true;
  chatValue.isLoading = false;
  sendMessage.mockClear();
  toastError.mockClear();
  recognizers = installFakeSpeechRecognition();
});

afterEach(() => {
  uninstallFakeSpeechRecognition();
  vi.useRealTimers();
});

describe('AI coach voice input', () => {
  it('offers no mic on a browser without speech recognition', () => {
    uninstallFakeSpeechRecognition();
    render(<AIChatBubble />);
    expect(screen.queryByLabelText('Start voice input')).toBeNull();
  });

  it('writes what is said into the message box, previewing the phrase in flight', () => {
    render(<AIChatBubble />);
    tapMic();
    expect(micIsOn()).toBeTruthy();
    expect(mic().continuous).toBe(false);

    browser.interim('add three sets of');
    expect(box()).toHaveValue('add three sets of');

    browser.final('add three sets of squats');
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('speaks after what was already typed', () => {
    render(<AIChatBubble />);
    fireEvent.change(box(), { target: { value: 'for tomorrow' } });
    tapMic();
    browser.final('add squats');
    expect(box()).toHaveValue('for tomorrow add squats');
  });

  it('writes a sentence once, however often the browser lists it', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets of squats');
    browser.replay();
    browser.duplicateFinal();
    browser.replay();
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('keeps listening across sentences and folds them in once the user goes quiet', () => {
    const first = render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets of squats');
    browser.endSession();
    expect(micIsOn()).toBeTruthy();
    expect(recognizers).toHaveLength(2);

    browser.interim('and');
    expect(box()).toHaveValue('add three sets of squats and');
    browser.final('and some lunges');
    browser.endSession();
    expect(recognizers).toHaveLength(3);

    browser.silence();
    expect(micIsOff()).toBeTruthy();
    expect(box()).toHaveValue('add three sets of squats and some lunges');

    // The words are now an ordinary draft.
    first.unmount();
    render(<AIChatBubble />);
    expect(box()).toHaveValue('add three sets of squats and some lunges');
  });

  it('keeps the phrase in flight when the browser ends the session under it', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets');
    browser.endSession();
    browser.interim('of squats');
    browser.endSession();
    browser.final('and lunges');
    expect(box()).toHaveValue('add three sets of squats and lunges');
  });

  it('lets the mic button end the run, taking the finalized phrase', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets');
    browser.endSession();
    browser.interim('of squ');
    tapStop();

    // Off at once, words still on screen, browser given a moment to finalize.
    expect(micIsOff()).toBeTruthy();
    expect(box()).toHaveValue('add three sets of squ');

    browser.final('of squats');
    act(() => mic().end());
    expect(box()).toHaveValue('add three sets of squats');

    // Nothing further lands, from the browser or from the clock.
    browser.wait(FINALIZE_GRACE_MS + SILENCE_TIMEOUT_MS);
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('takes the phrase in flight as it stands if the browser never finalizes it', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.interim('add three sets');
    tapStop();
    browser.wait(FINALIZE_GRACE_MS);
    expect(box()).toHaveValue('add three sets');
  });

  it('carries a second run on after the words already in the box', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets');
    tapStop();
    act(() => mic().end());
    expect(box()).toHaveValue('add three sets');

    tapMic();
    browser.final('of squats');
    browser.replay();
    expect(box()).toHaveValue('add three sets of squats');
    tapStop();
    act(() => mic().end());
    expect(box()).toHaveValue('add three sets of squats');
  });

  it('sends the dictated message and lets nothing come back afterwards', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.interim('add three sets of squats');
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('add three sets of squats');
    expect(box()).toHaveValue('');
    expect(micIsOff()).toBeTruthy();

    // The phrase finalizes after the send; its words have already gone.
    const sent = mic();
    act(() => {
      sent.final('add three sets of squats');
      sent.end();
      vi.advanceTimersByTime(FINALIZE_GRACE_MS + SILENCE_TIMEOUT_MS);
    });
    expect(box()).toHaveValue('');
    expect(recognizers).toHaveLength(1);
  });

  it('sends with Enter while listening', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add squats');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(sendMessage).toHaveBeenCalledWith('add squats');
    expect(box()).toHaveValue('');
    expect(micIsOff()).toBeTruthy();
  });

  it('sends what is on screen if sent while the browser is still finalizing', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.interim('add three sets');
    tapStop();
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('add three sets');
    expect(box()).toHaveValue('');
    browser.wait(FINALIZE_GRACE_MS);
    expect(box()).toHaveValue('');
  });

  it('lets typing take over from talking', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets of squats');

    fireEvent.change(box(), { target: { value: 'add four sets of squats' } });
    expect(micIsOff()).toBeTruthy();
    expect(box()).toHaveValue('add four sets of squats');

    const dropped = mic();
    act(() => {
      dropped.final('add three sets of squats');
      dropped.end();
      vi.advanceTimersByTime(FINALIZE_GRACE_MS + SILENCE_TIMEOUT_MS);
    });
    expect(box()).toHaveValue('add four sets of squats');
  });

  it('folds the words into the draft when the panel is dismissed', () => {
    const { rerender } = render(<AIChatBubble />);
    tapMic();
    browser.final('add squats');

    chatValue.isOpen = false;
    rerender(<AIChatBubble />);
    act(() => mic().end());
    chatValue.isOpen = true;
    rerender(<AIChatBubble />);

    expect(micIsOff()).toBeTruthy();
    expect(box()).toHaveValue('add squats');
  });

  it('can switch the microphone off while a reply is streaming', () => {
    const { rerender } = render(<AIChatBubble />);
    tapMic();
    browser.final('add squats');
    chatValue.isLoading = true;
    rerender(<AIChatBubble />);

    tapStop();
    expect(micIsOff()).toBeTruthy();
  });

  it('explains a blocked microphone instead of failing silently', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.error('not-allowed');
    expect(toastError).toHaveBeenCalledWith(
      'Microphone access is blocked. Allow it in your browser settings to dictate.',
    );
    expect(micIsOff()).toBeTruthy();
  });

  it('keeps what was already said when the microphone drops out', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('add three sets');
    browser.error('network');
    expect(box()).toHaveValue('add three sets');
    expect(micIsOff()).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith('Voice input stopped unexpectedly.');
  });

  it('holds dictation to the message length limit', () => {
    render(<AIChatBubble />);
    tapMic();
    browser.final('squat '.repeat(120).trim());
    expect(box().value.length).toBe(500);
    tapStop();
    act(() => mic().end());
    expect(box().value.length).toBe(500);
  });

  it('folds the words in exactly once under StrictMode', () => {
    // StrictMode mounts, unmounts and remounts, and double-invokes effects; a
    // fold that ran per effect would double the words here.
    render(
      <React.StrictMode>
        <AIChatBubble />
      </React.StrictMode>,
    );
    tapMic();
    browser.final('add three sets of squats');
    browser.endSession();
    browser.silence();
    expect(box()).toHaveValue('add three sets of squats');

    tapMic();
    browser.final('and lunges');
    tapStop();
    act(() => mic().end());
    expect(box()).toHaveValue('add three sets of squats and lunges');
  });
});
