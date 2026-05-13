import { useCallback, useEffect, useState } from 'react';
import {
  getRestTimerSound,
  setRestTimerSound,
  preloadRestTimerSound,
  type RestTimerSound,
} from '@/utils/restTimerSound';

/**
 * React state wrapper around the rest-timer sound preference (persisted to localStorage).
 * Used by the Settings UI; the timer itself reads the value directly from the utility
 * module at scheduling time so it always sees the freshest preference without re-rendering.
 */
export function useRestTimerSound() {
  const [sound, setSoundState] = useState<RestTimerSound>(() => getRestTimerSound());

  useEffect(() => {
    preloadRestTimerSound(sound);
  }, [sound]);

  const setSound = useCallback((next: RestTimerSound) => {
    setRestTimerSound(next);
    setSoundState(next);
  }, []);

  return { sound, setSound };
}
