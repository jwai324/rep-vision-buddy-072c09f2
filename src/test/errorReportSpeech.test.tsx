import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FINALIZE_GRACE_MS, RESTART_DELAY_MS, SILENCE_TIMEOUT_MS } from '@/utils/speechToText';
import {
  type FakeSpeechRecognition,
  installFakeSpeechRecognition,
  uninstallFakeSpeechRecognition,
} from './helpers/fakeSpeechRecognition';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertResult: { data: null, error: null as null | { message: string } },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        mocks.insert(row);
        return Promise.resolve(mocks.insertResult);
      },
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  },
}));

import { ErrorReportButton } from '@/components/ErrorReportButton';

let recognizers: FakeSpeechRecognition[] = [];
const mic = () => recognizers[recognizers.length - 1];

const happened = () => screen.getByLabelText('What happened') as HTMLTextAreaElement;
const expected = () => screen.getByLabelText('What should happen instead') as HTMLTextAreaElement;
const tapMic = (label: string) => fireEvent.click(screen.getByLabelText(`Start voice input for ${label}`));
const tapStop = (label: string) => fireEvent.click(screen.getByLabelText(`Stop voice input for ${label}`));
const micIsOn = (label: string) => screen.getByLabelText(`Stop voice input for ${label}`);
const micIsOff = (label: string) => screen.getByLabelText(`Start voice input for ${label}`);

/** Browser events reach React from outside its own handlers, hence `act`. */
const browser = {
  interim: (text: string) => act(() => mic().interim(text)),
  final: (text: string) => act(() => mic().final(text)),
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
  error: (code: string) => act(() => mic().error(code)),
  wait: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
};

/** Ends the run the mic button just stopped, the way the browser would. */
const finishRun = () =>
  act(() => {
    mic().end();
    vi.advanceTimersByTime(RESTART_DELAY_MS);
  });

/** Radix animates the sheet in; the flush keeps its updates inside act. */
async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

async function dismissSheet() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  localStorage.clear();
  mocks.insert.mockClear();
  mocks.toastSuccess.mockClear();
  mocks.toastError.mockClear();
  mocks.insertResult = { data: null, error: null };
  recognizers = installFakeSpeechRecognition();
});

afterEach(() => {
  uninstallFakeSpeechRecognition();
  vi.useRealTimers();
});

describe('bug report voice input', () => {
  it('offers no mic on a browser without speech recognition', async () => {
    uninstallFakeSpeechRecognition();
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    expect(screen.queryByLabelText(/voice input/)).toBeNull();
  });

  it('writes what is said into the box that was tapped, previewing the phrase in flight', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    expect(micIsOn('What happened')).toBeTruthy();
    expect(mic().continuous).toBe(false);

    browser.interim('the rest timer');
    expect(happened()).toHaveValue('the rest timer');
    expect(expected()).toHaveValue('');

    browser.final('the rest timer showed ninety seconds');
    tapStop('What happened');
    finishRun();
    expect(happened()).toHaveValue('the rest timer showed ninety seconds');
    expect(expected()).toHaveValue('');
  });

  it('dictates into the second box after what was already typed there', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    fireEvent.change(expected(), { target: { value: 'it should' } });
    tapMic('What should happen instead');
    browser.final('use the template rest time');
    expect(expected()).toHaveValue('it should use the template rest time');
    expect(happened()).toHaveValue('');
  });

  it('hands the words to the box being dictated into before opening the other one', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.final('rest timer is wrong');

    // The other box's mic while the first run is live: the words in flight
    // belong to the box they were spoken into.
    tapMic('What should happen instead');
    expect(happened()).toHaveValue('rest timer is wrong');
    finishRun();

    expect(happened()).toHaveValue('rest timer is wrong');
    expect(micIsOn('What should happen instead')).toBeTruthy();
    expect(micIsOff('What happened')).toBeTruthy();

    browser.final('use the template rest time');
    expect(expected()).toHaveValue('use the template rest time');
    expect(happened()).toHaveValue('rest timer is wrong');
  });

  it('moves the microphone to the other box when nothing has been said yet', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    tapMic('What should happen instead');
    // The run being dropped is still tearing its recognizer down, so the next
    // session waits out the restart delay rather than racing it.
    browser.wait(RESTART_DELAY_MS);

    expect(micIsOn('What should happen instead')).toBeTruthy();
    browser.final('use the template rest time');
    expect(expected()).toHaveValue('use the template rest time');
    expect(happened()).toHaveValue('');
  });

  it('keeps listening across sentences and folds them in once the user goes quiet', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.final('rest timer is wrong');
    browser.endSession();
    expect(recognizers).toHaveLength(2);

    browser.interim('on');
    expect(happened()).toHaveValue('rest timer is wrong on');
    browser.final('on the squat template');
    browser.endSession();
    browser.silence();

    expect(micIsOff('What happened')).toBeTruthy();
    expect(happened()).toHaveValue('rest timer is wrong on the squat template');
  });

  it('lets typing take over from talking in the box being dictated into', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.final('rest timer is wrong');

    fireEvent.change(happened(), { target: { value: 'rest timer is off by 30s' } });
    expect(micIsOff('What happened')).toBeTruthy();
    expect(happened()).toHaveValue('rest timer is off by 30s');

    const dropped = mic();
    act(() => {
      dropped.final('rest timer is wrong');
      dropped.end();
      vi.advanceTimersByTime(FINALIZE_GRACE_MS + SILENCE_TIMEOUT_MS);
    });
    expect(happened()).toHaveValue('rest timer is off by 30s');
  });

  it('leaves the run alone while the other box is typed in', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.final('rest timer is wrong');

    fireEvent.change(expected(), { target: { value: 'use 60s' } });
    expect(micIsOn('What happened')).toBeTruthy();
    expect(happened()).toHaveValue('rest timer is wrong');

    tapStop('What happened');
    finishRun();
    expect(happened()).toHaveValue('rest timer is wrong');
    expect(expected()).toHaveValue('use 60s');
  });

  it('sends the dictated report and lets nothing come back afterwards', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.interim('rest timer is wrong');
    tapMic('What should happen instead');
    finishRun();
    browser.final('use the template rest time');

    fireEvent.click(screen.getByRole('button', { name: /send report/i }));
    await act(async () => {});

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      description: 'rest timer is wrong',
      expected: 'use the template rest time',
    });
    expect(mocks.toastSuccess).toHaveBeenCalled();

    // The phrase finalizes after the send; its words have already gone.
    const sent = mic();
    act(() => {
      sent.final('use the template rest time');
      sent.end();
      vi.advanceTimersByTime(FINALIZE_GRACE_MS + SILENCE_TIMEOUT_MS);
    });
    expect(localStorage.getItem('error-report-draft')).toBeNull();
  });

  it('keeps the dictated text when the send fails', async () => {
    mocks.insertResult = { data: null, error: { message: 'network' } };
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.interim('rest timer is wrong');

    fireEvent.click(screen.getByRole('button', { name: /send report/i }));
    await act(async () => {});

    expect(mocks.toastError).toHaveBeenCalled();
    expect(happened()).toHaveValue('rest timer is wrong');
    expect(localStorage.getItem('error-report-draft')).toBe('rest timer is wrong');
  });

  it('folds the words into the draft when the sheet is dismissed', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.final('rest timer is wrong');

    await dismissSheet();
    act(() => {
      mic().end();
      vi.advanceTimersByTime(FINALIZE_GRACE_MS);
    });
    expect(localStorage.getItem('error-report-draft')).toBe('rest timer is wrong');

    await openSheet();
    expect(micIsOff('What happened')).toBeTruthy();
    expect(happened()).toHaveValue('rest timer is wrong');
  });

  it('explains a blocked microphone instead of failing silently', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What happened');
    browser.error('not-allowed');
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Microphone access is blocked. Allow it in your browser settings to dictate.',
    );
    expect(micIsOff('What happened')).toBeTruthy();
  });

  it('holds dictation to each box’s length limit', async () => {
    render(<ErrorReportButton screen="dashboard" />);
    await openSheet();
    tapMic('What should happen instead');
    browser.final('rest '.repeat(300).trim());
    expect(expected().value.length).toBe(1000);
    tapStop('What should happen instead');
    finishRun();
    expect(expected().value.length).toBe(1000);
  });
});
