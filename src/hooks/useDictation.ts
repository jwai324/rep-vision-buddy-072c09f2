import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Dictation, type DictationFailure, type DictationState } from '@/utils/dictation';

export type { DictationFailure } from '@/utils/dictation';

export interface UseDictationOptions {
  lang?: string;
  onFailure?: (failure: DictationFailure) => void;
}

export interface UseDictation extends DictationState {
  supported: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** Drop the transcript without ending the run — see Dictation.reset. */
  reset: () => void;
}

/**
 * React binding for `Dictation`. The engine is the store and this only
 * subscribes to it, so a parent re-render can't disturb a run in progress —
 * which is the failure mode of a hook that keeps the recognizer in effects.
 */
export function useDictation(options: UseDictationOptions = {}): UseDictation {
  const { lang, onFailure } = options;

  // Held in a ref so a caller passing an inline callback doesn't tear down the
  // engine — and with it the microphone — on every render.
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    onFailureRef.current = onFailure;
  }, [onFailure]);

  const dictation = useMemo(
    () => new Dictation({ lang, onFailure: failure => onFailureRef.current?.(failure) }),
    [lang],
  );
  useEffect(() => () => dictation.dispose(), [dictation]);

  const state = useSyncExternalStore(dictation.subscribe, dictation.getState, dictation.getState);

  return {
    ...state,
    supported: dictation.supported,
    start: dictation.start,
    stop: dictation.stop,
    toggle: dictation.toggle,
    reset: dictation.reset,
  };
}
