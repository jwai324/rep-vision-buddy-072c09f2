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

  it('resets interim transcript when listening ends', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => latestInstance!.fireResult([{ transcript: 'partial', isFinal: false }]));
    expect(result.current.interimTranscript).toBe('partial');

    act(() => result.current.stop());
    expect(result.current.interimTranscript).toBe('');
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
