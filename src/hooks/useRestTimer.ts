import { useState, useEffect, useCallback, useRef } from 'react';

export function useRestTimer(defaultDuration: number = 90) {
  const [duration, setDuration] = useState(defaultDuration);
  const [remaining, setRemaining] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isActive && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 1) {
            setIsActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, remaining]);

  const start = useCallback((dur?: number) => {
    const d = dur ?? duration;
    setDuration(d);
    setRemaining(d);
    setIsActive(true);
  }, [duration]);

  const skip = useCallback(() => {
    setRemaining(0);
    setIsActive(false);
  }, []);

  const extend = useCallback((seconds: number = 30) => {
    setRemaining(prev => prev + seconds);
    setDuration(prev => prev + seconds);
  }, []);

  const progress = duration > 0 ? (duration - remaining) / duration : 0;

  return { remaining, isActive, progress, duration, start, skip, extend };
}
