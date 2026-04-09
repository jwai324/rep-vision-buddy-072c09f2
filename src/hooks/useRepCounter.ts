import { useState, useCallback } from 'react';

export function useRepCounter() {
  const [reps, setReps] = useState(0);

  const increment = useCallback(() => {
    setReps(prev => prev + 1);
  }, []);

  const reset = useCallback(() => {
    setReps(0);
  }, []);

  return { reps, increment, reset };
}
