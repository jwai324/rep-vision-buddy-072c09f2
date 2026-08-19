import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition, trimEchoedPrefix, type SpeechRecognitionLike } from '@/hooks/useSpeechRecognition';

// A minimal stand-in for the browser SpeechRecognition class. We record
// starts/stops and expose helpers to fire the events the hook listens for.
class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: SpeechRecognitionLike['onstart'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onresult: SpeechRecognitionLike['onresult'] = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  start() {
    this.started++;
    this.onstart?.call(this, new Event('start'));
  }
  stop() {
    this.stopped++;
    this.onend?.call(this, new Event('end'));
  }
  abort() {
    this.aborted++;
  }
  /**
   * What Chrome does on its own after a few seconds of silence: it ends the
   * session without the caller asking. The hook is expected to treat this as
   * a gap to paper over, not as the user stopping.
   */
  fireSilenceTimeout() {
    this.onend?.call(this, new Event('end'));
  }
  fireResult(chunks: { transcript: string; isFinal: boolean }[], resultIndex = 0) {
    const results = chunks.map(c => {
      const list = [{ transcript: c.transcript }] as unknown as {
        readonly length: number;
        readonly isFinal: boolean;
        [i: number]: { transcript: string };
      };
      // Mimic SpeechRecognitionResult's shape: array-like with length + isFinal.
      Object.defineProperty(list, 'length', { value: 1 });
      Object.defineProperty(list, 'isFinal', { value: c.isFinal });
      return list;
    });
    const resultList = results as unknown as { length: number; [i: number]: unknown };
    Object.defineProperty(resultList, 'length', { value: results.length });
    this.onresult?.call(this, { resultIndex, results: resultList } as never);
  }
  fireError(error: string) {
    this.onerror?.call(this, { error } as never);
  }
}

let latestInstance: FakeRecognition | null = null;

beforeEach(() => {
  latestInstance = null;
  (window as unknown as { SpeechRecognition: typeof FakeRecognition }).SpeechRecognition =
    class extends FakeRecognition {
      constructor() { super(); latestInstance = this; }
    } as unknown as typeof FakeRecognition;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('trimEchoedPrefix', () => {
  it('returns the phrase untouched when nothing overlaps', () => {
    expect(trimEchoedPrefix(['lift', 'heavy'], 'then go home')).toBe('then go home');
  });

  it('returns an empty string when the whole phrase is an echo', () => {
    expect(trimEchoedPrefix(['lift', 'heavy'], 'lift heavy')).toBe('');
  });

  it('keeps the part that continues past the overlap', () => {
    expect(trimEchoedPrefix(['add', 'three', 'sets'], 'three sets of squats')).toBe('of squats');
  });

  it('prefers the longest overlap when a word repeats', () => {
    // "sets sets of ten" would be the result of matching only the final word.
    expect(trimEchoedPrefix(['do', 'three', 'sets'], 'three sets of ten')).toBe('of ten');
  });

  it('matches through punctuation and casing differences', () => {
    expect(trimEchoedPrefix(['lift', 'heavy'], 'Lift heavy, today')).toBe('today');
  });

  it('has nothing to trim against an empty tail', () => {
    expect(trimEchoedPrefix([], 'lift heavy')).toBe('lift heavy');
  });
});

describe('useSpeechRecognition', () => {
  it('reports unsupported when neither global is present', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(false);
  });

  it('starts and stops in response to toggle()', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.isListening).toBe(false);

    act(() => result.current.toggle());
    expect(latestInstance?.started).toBe(1);
    expect(result.current.isListening).toBe(true);

    act(() => result.current.toggle());
    expect(latestInstance?.stopped).toBe(1);
    expect(result.current.isListening).toBe(false);
  });

  it('emits final chunks to onFinalResult and exposes interim text', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
    act(() => result.current.start());

    act(() => latestInstance!.fireResult([{ transcript: 'hello wor', isFinal: false }]));
    expect(result.current.interimTranscript).toBe('hello wor');
    expect(onFinal).not.toHaveBeenCalled();

    act(() => latestInstance!.fireResult([{ transcript: 'hello world', isFinal: true }]));
    expect(onFinal).toHaveBeenCalledWith('hello world');
  });

  describe('does not repeat or jumble what was said', () => {
    it('ignores a redelivery of a final result it already emitted', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      const phrase = [{ transcript: 'add three sets of squats', isFinal: true }];
      act(() => latestInstance!.fireResult(phrase));
      // Chrome replays the cumulative list without advancing resultIndex past
      // results it has already finalized.
      act(() => latestInstance!.fireResult(phrase, 0));

      expect(onFinal).toHaveBeenCalledTimes(1);
    });

    it('emits only the new phrase when a stale resultIndex replays earlier ones', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'first phrase', isFinal: true }]));
      act(() => latestInstance!.fireResult(
        [
          { transcript: 'first phrase', isFinal: true },
          { transcript: 'second phrase', isFinal: true },
        ],
        0,
      ));

      expect(onFinal).toHaveBeenCalledTimes(2);
      expect(onFinal).toHaveBeenNthCalledWith(1, 'first phrase');
      expect(onFinal).toHaveBeenNthCalledWith(2, 'second phrase');
    });

    it('keeps emitting when the browser hands back a shorter result list', () => {
      // Some engines restart their result list mid-session instead of growing
      // it; gating on the old count would drop everything said afterwards.
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([
        { transcript: 'first', isFinal: true },
        { transcript: 'second', isFinal: true },
      ]));
      act(() => latestInstance!.fireResult([{ transcript: 'third', isFinal: true }]));

      expect(onFinal.mock.calls.map(c => c[0])).toEqual(['first', 'second', 'third']);
    });

    it('still emits a phrase the user genuinely repeats in one session', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'go', isFinal: true }]));
      act(() => latestInstance!.fireResult([
        { transcript: 'go', isFinal: true },
        { transcript: 'go', isFinal: true },
      ]));

      expect(onFinal).toHaveBeenCalledTimes(2);
    });

    it('spaces interim segments instead of running them together', () => {
      const onInterim = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onInterimResult: onInterim }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([
        { transcript: 'done with', isFinal: true },
        { transcript: 'now add', isFinal: false },
        { transcript: 'bench press', isFinal: false },
      ]));

      expect(result.current.interimTranscript).toBe('now add bench press');
      expect(onInterim).toHaveBeenLastCalledWith('now add bench press');
    });
  });

  it('surfaces real errors but swallows aborted/no-speech', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));
    act(() => result.current.start());

    act(() => latestInstance!.fireError('aborted'));
    act(() => latestInstance!.fireError('no-speech'));
    expect(onError).not.toHaveBeenCalled();

    act(() => result.current.start());
    act(() => latestInstance!.fireError('not-allowed'));
    expect(onError).toHaveBeenCalledWith('not-allowed');
    expect(result.current.isListening).toBe(false);
  });

  describe('stays live until the user stops it', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('restarts itself when the browser ends the session on a silence timeout', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());
      expect(latestInstance!.started).toBe(1);

      act(() => latestInstance!.fireSilenceTimeout());
      // The mic button must not flicker off while we bridge the gap.
      expect(result.current.isListening).toBe(true);

      act(() => { vi.advanceTimersByTime(0); });
      expect(latestInstance!.started).toBe(2);
      expect(result.current.isListening).toBe(true);
    });

    it('keeps accumulating final chunks across a restart', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'first phrase', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      act(() => latestInstance!.fireResult([{ transcript: 'second phrase', isFinal: true }]));

      expect(onFinal).toHaveBeenNthCalledWith(1, 'first phrase');
      expect(onFinal).toHaveBeenNthCalledWith(2, 'second phrase');
    });

    it('drops the previous session\'s last phrase when the new one re-hears it', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      // The fresh session re-recognises the tail of the audio the old one
      // already finalised.
      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));

      expect(onFinal).toHaveBeenCalledTimes(1);
    });

    it('keeps only the new words when the restart re-hears part of the phrase', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'add three sets', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      // The restarted session hears the tail again and carries on past it.
      act(() => latestInstance!.fireResult([{ transcript: 'add three sets of squats', isFinal: true }]));

      expect(onFinal).toHaveBeenNthCalledWith(2, 'of squats');
    });

    it('matches an echo back across more than one earlier phrase', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'add three sets', isFinal: true }]));
      // The session's result list is cumulative, so the second phrase arrives
      // alongside the first.
      act(() => latestInstance!.fireResult([
        { transcript: 'add three sets', isFinal: true },
        { transcript: 'of squats', isFinal: true },
      ]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      act(() => latestInstance!.fireResult([{ transcript: 'three sets of squats', isFinal: true }]));

      expect(onFinal).toHaveBeenCalledTimes(2);
    });

    it('ignores punctuation and casing when matching the echo', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy today', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      act(() => latestInstance!.fireResult([{ transcript: 'Lift heavy, today!', isFinal: true }]));

      expect(onFinal).toHaveBeenCalledTimes(1);
    });

    it('still drops an echo that the recogniser takes seconds to deliver', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      // Well past the 2s the previous implementation allowed for.
      act(() => { vi.advanceTimersByTime(3000); });
      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));

      expect(onFinal).toHaveBeenCalledTimes(1);
    });

    it('treats the same words much later as the user saying them again', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(7000); });
      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));

      expect(onFinal).toHaveBeenCalledTimes(2);
    });

    it('leaves an unrelated phrase after a restart alone', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      act(() => latestInstance!.fireResult([{ transcript: 'then go home', isFinal: true }]));

      expect(onFinal).toHaveBeenNthCalledWith(2, 'then go home');
    });

    it('passes a repeat through once the restarted session has said something new', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'squats', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      // Echo, then real speech, then the user genuinely says it twice.
      act(() => latestInstance!.fireResult([{ transcript: 'squats', isFinal: true }]));
      act(() => latestInstance!.fireResult([
        { transcript: 'squats', isFinal: true },
        { transcript: 'and lunges', isFinal: true },
      ]));
      act(() => latestInstance!.fireResult([
        { transcript: 'squats', isFinal: true },
        { transcript: 'and lunges', isFinal: true },
        { transcript: 'and lunges', isFinal: true },
      ]));

      expect(onFinal.mock.calls.map(c => c[0])).toEqual(['squats', 'and lunges', 'and lunges']);
    });

    it('keeps the live preview from replaying words already in the box', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });
      act(() => latestInstance!.fireResult([{ transcript: 'lift heavy today', isFinal: false }]));

      expect(result.current.interimTranscript).toBe('today');
    });

    it('does not restart after the user stops it', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());

      act(() => result.current.stop());
      expect(result.current.isListening).toBe(false);

      act(() => { vi.advanceTimersByTime(50); });
      expect(latestInstance!.started).toBe(1);
      expect(result.current.isListening).toBe(false);
    });

    it('does not restart after a second toggle', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.toggle());
      act(() => result.current.toggle());

      act(() => { vi.advanceTimersByTime(50); });
      expect(latestInstance!.started).toBe(1);
      expect(latestInstance!.stopped).toBe(1);
      expect(result.current.isListening).toBe(false);
    });

    it('gives up instead of respawning forever when sessions die immediately', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onError }));
      act(() => result.current.start());

      for (let i = 0; i < 10; i++) {
        act(() => latestInstance!.fireSilenceTimeout());
        act(() => { vi.advanceTimersByTime(0); });
      }

      expect(result.current.isListening).toBe(false);
      expect(onError).toHaveBeenCalledWith('restart-loop');
      // 1 initial + at most the per-window allowance, not 11.
      expect(latestInstance!.started).toBeLessThanOrEqual(6);
    });

    it('stops for good on a denied microphone rather than retrying', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onError }));
      act(() => result.current.start());

      act(() => latestInstance!.fireError('not-allowed'));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(50); });

      expect(onError).toHaveBeenCalledWith('not-allowed');
      expect(result.current.isListening).toBe(false);
      expect(latestInstance!.started).toBe(1);
    });

    it('keeps listening through a silent stretch short of the stop window', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onError }));
      act(() => result.current.start());

      act(() => latestInstance!.fireError('no-speech'));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(0); });

      expect(onError).not.toHaveBeenCalled();
      expect(result.current.isListening).toBe(true);
      expect(latestInstance!.started).toBe(2);
    });

    it('releases the microphone when the component unmounts mid-session', () => {
      const { result, unmount } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());
      act(() => latestInstance!.fireSilenceTimeout());

      unmount();
      act(() => { vi.advanceTimersByTime(50); });

      expect(latestInstance!.aborted).toBe(1);
      expect(latestInstance!.started).toBe(1);
    });
  });

  describe('stops itself once the user is actually done', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('turns off after a long silence', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());

      act(() => { vi.advanceTimersByTime(7900); });
      expect(result.current.isListening).toBe(true);

      act(() => { vi.advanceTimersByTime(200); });
      expect(result.current.isListening).toBe(false);
    });

    it('is not kept alive by the restarts that bridge the pause', () => {
      // The browser ends a session a second or two after you stop talking. The
      // silence is measured from the last words, not from those restarts, or
      // dictation would never decide you were finished.
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'add three sets', isFinal: true }]));
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(1500); });
      act(() => latestInstance!.fireSilenceTimeout());
      act(() => { vi.advanceTimersByTime(1500); });
      expect(result.current.isListening).toBe(true);

      act(() => { vi.advanceTimersByTime(6000); });
      expect(result.current.isListening).toBe(false);
    });

    it('keeps listening as long as words keep arriving', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());

      // Interim text counts — it is the earliest sign of someone mid-sentence.
      act(() => { vi.advanceTimersByTime(6000); });
      act(() => latestInstance!.fireResult([{ transcript: 'still talking', isFinal: false }]));
      act(() => { vi.advanceTimersByTime(6000); });
      expect(result.current.isListening).toBe(true);

      act(() => { vi.advanceTimersByTime(2100); });
      expect(result.current.isListening).toBe(false);
    });

    it('does not restart once it has stopped itself', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());
      expect(latestInstance!.started).toBe(1);

      act(() => { vi.advanceTimersByTime(8100); });
      act(() => { vi.advanceTimersByTime(1000); });

      expect(latestInstance!.started).toBe(1);
      expect(result.current.isListening).toBe(false);
    });

    it('closes a mic that was opened and never spoken into', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      act(() => result.current.start());

      act(() => { vi.advanceTimersByTime(8100); });

      expect(result.current.isListening).toBe(false);
      expect(latestInstance!.stopped).toBe(1);
    });

    it('honours a caller-supplied window', () => {
      const { result } = renderHook(() => useSpeechRecognition({ stopAfterSilenceMs: 3000 }));
      act(() => result.current.start());

      act(() => { vi.advanceTimersByTime(2900); });
      expect(result.current.isListening).toBe(true);

      act(() => { vi.advanceTimersByTime(200); });
      expect(result.current.isListening).toBe(false);
    });

    it('stays live indefinitely when the window is disabled', () => {
      const { result } = renderHook(() => useSpeechRecognition({ stopAfterSilenceMs: 0 }));
      act(() => result.current.start());

      act(() => { vi.advanceTimersByTime(60_000); });

      expect(result.current.isListening).toBe(true);
    });

    it('emits everything said before the silence ran out', () => {
      const onFinal = vi.fn();
      const { result } = renderHook(() => useSpeechRecognition({ onFinalResult: onFinal }));
      act(() => result.current.start());

      act(() => latestInstance!.fireResult([{ transcript: 'add three sets of squats', isFinal: true }]));
      act(() => { vi.advanceTimersByTime(8100); });

      expect(onFinal).toHaveBeenCalledWith('add three sets of squats');
      expect(result.current.isListening).toBe(false);
    });
  });

  it('resets interim transcript when listening ends', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => latestInstance!.fireResult([{ transcript: 'partial', isFinal: false }]));
    expect(result.current.interimTranscript).toBe('partial');

    act(() => result.current.stop());
    expect(result.current.interimTranscript).toBe('');
  });

  it('asks the browser for a continuous session by default', () => {
    renderHook(() => useSpeechRecognition());
    expect(latestInstance?.continuous).toBe(true);
  });

  it('can be opted out of continuous mode', () => {
    renderHook(() => useSpeechRecognition({ continuous: false }));
    expect(latestInstance?.continuous).toBe(false);
  });

  it('falls back to webkitSpeechRecognition when the unprefixed global is absent', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    (window as unknown as { webkitSpeechRecognition: typeof FakeRecognition }).webkitSpeechRecognition =
      class extends FakeRecognition {
        constructor() { super(); latestInstance = this; }
      } as unknown as typeof FakeRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(true);
    act(() => result.current.start());
    expect(latestInstance?.started).toBe(1);
  });
});
