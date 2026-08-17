import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition, type SpeechRecognitionLike } from '@/hooks/useSpeechRecognition';

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

    it('keeps listening through a silent stretch', () => {
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
