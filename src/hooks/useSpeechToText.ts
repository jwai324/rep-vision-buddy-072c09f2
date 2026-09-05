import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
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
        // The engine clears its transcript and then hands the words over. The
        // store change re-renders synchronously, but a setState made from a
        // browser event or a timer is a lower-priority update that React would
        // commit separately — a frame in which the words are on screen in
        // neither place, and a tap landing there would act on a box without
        // them. flushSync gives the hand-over the same priority, so both land
        // in one commit. It is never reached from inside a render or an
        // effect: the engine hands words over only from browser events, its
        // own timers, and the mic button.
        onEnd: words => flushSync(() => onEndRef.current?.(words)),
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
