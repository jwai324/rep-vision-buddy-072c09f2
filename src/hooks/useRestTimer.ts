import { useState, useEffect, useCallback, useRef } from 'react';

export function useRestTimer(defaultDuration: number = 90) {
  const [duration, setDuration] = useState(defaultDuration);
  const [remaining, setRemaining] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0); // performance.now() anchor
  const totalDurationRef = useRef<number>(0);

  const recalc = useCallback(() => {
    if (!startedAtRef.current) return;
    const elapsed = Math.floor((performance.now() - startedAtRef.current) / 1000);
    const newRemaining = Math.max(0, totalDurationRef.current - elapsed);
    setRemaining(newRemaining);
    if (newRemaining <= 0) {
      setIsActive(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      intervalRef.current = setInterval(recalc, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, recalc]);

  // Visibility change: instant catch-up on foreground
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && isActive) {
        recalc();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [isActive, recalc]);

  const start = useCallback((dur?: number) => {
    const d = dur ?? duration;
    setDuration(d);
    totalDurationRef.current = d;
    startedAtRef.current = performance.now();
    setRemaining(d);
    setIsActive(true);
  }, [duration]);

  const skip = useCallback(() => {
    setRemaining(0);
    setIsActive(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const extend = useCallback((seconds: number = 30) => {
    totalDurationRef.current += seconds;
    setDuration(prev => prev + seconds);
    recalc();
  }, [recalc]);

  const progress = duration > 0 ? (duration - remaining) / duration : 0;

  return { remaining, isActive, progress, duration, start, skip, extend };
}
