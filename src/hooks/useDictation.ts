import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  DictationEngine,
  type DictationFailure,
  type DictationState,
} from '@/utils/dictationEngine';

export type { DictationFailure } from '@/utils/dictationEngine';

export interface UseDictationOptions {
  lang?: string;
  onFailure?: (failure: DictationFailure) => void;
}

export interface UseDictation extends DictationState {
  supported: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** Drop the transcript without ending the run — see DictationEngine.reset. */
  reset: () => void;
}

/**
 * React binding for `DictationEngine`. The engine is the store and this only
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

  const engine = useMemo(
    () => new DictationEngine({ lang, onFailure: failure => onFailureRef.current?.(failure) }),
    [lang],
  );
  useEffect(() => () => engine.dispose(), [engine]);

  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  return {
    ...state,
    supported: engine.supported,
    start: engine.start,
    stop: engine.stop,
    toggle: engine.toggle,
    reset: engine.reset,
  };
}
