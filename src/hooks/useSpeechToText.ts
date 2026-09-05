import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SpeechToText, type SpeechToTextError, type SpeechToTextState } from '@/utils/speechToText';

export type { SpeechToTextError } from '@/utils/speechToText';

export interface UseSpeechToTextOptions {
  lang?: string;
  /** The run's words, delivered exactly once, when the run finishes. */
  onEnd?: (words: string) => void;
  onError?: (error: SpeechToTextError) => void;
}

export interface UseSpeechToText extends SpeechToTextState {
  supported: boolean;
  start: () => void;
  stop: () => void;
  /** Switch the microphone off and forget the run's words. */
  cancel: () => void;
  toggle: () => void;
}

/**
 * React binding for `SpeechToText`. The engine is the store and this only
 * subscribes to it, so a parent re-render can't disturb a run in progress. The
 * engine is created once per mounted component; `lang` is read at creation.
 */
export function useSpeechToText(options: UseSpeechToTextOptions = {}): UseSpeechToText {
  const { lang, onEnd, onError } = options;

  // Held in refs so a caller passing inline callbacks doesn't tear down the
  // engine — and with it the microphone — on every render.
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
  }, [onEnd, onError]);

  const [engine] = useState(
    () =>
      new SpeechToText({
        lang,
        onEnd: words => onEndRef.current?.(words),
        onError: error => onErrorRef.current?.(error),
      }),
  );
  useEffect(() => () => engine.dispose(), [engine]);

  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  return {
    ...state,
    supported: engine.supported,
    start: engine.start,
    stop: engine.stop,
    cancel: engine.cancel,
    toggle: engine.toggle,
  };
}
