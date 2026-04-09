import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Timer, SkipForward, Plus } from 'lucide-react';

interface ExerciseRestTimerProps {
  /** Timer key – changes reset the timer */
  timerKey: number;
  defaultDuration: number;
  variant?: 'inline' | 'between';
}

export const ExerciseRestTimer: React.FC<ExerciseRestTimerProps> = ({ timerKey, defaultDuration, variant = 'inline' }) => {
  const [remaining, setRemaining] = useState(0);
  const [duration, setDuration] = useState(defaultDuration);
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastKey = useRef(timerKey);

  // Auto-start when timerKey changes (set completed)
  useEffect(() => {
    if (timerKey !== lastKey.current && timerKey > 0) {
      lastKey.current = timerKey;
      setDuration(defaultDuration);
      setRemaining(defaultDuration);
      setIsActive(true);
    }
  }, [timerKey, defaultDuration]);

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

  const skip = useCallback(() => {
    setRemaining(0);
    setIsActive(false);
  }, []);

  const extend = useCallback(() => {
    setRemaining(prev => prev + 30);
    setDuration(prev => prev + 30);
  }, []);

  const startManually = useCallback(() => {
    setDuration(defaultDuration);
    setRemaining(defaultDuration);
    setIsActive(true);
  }, [defaultDuration]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  if (variant === 'between') {
    if (!isActive && remaining === 0) {
      return (
        <div className="flex items-center justify-center py-2">
          <button
            onClick={startManually}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/40 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <Timer className="w-3 h-3" />
            Start Rest
          </button>
        </div>
      );
    }

    const progress = duration > 0 ? (duration - remaining) / duration : 0;

    return (
      <div className="flex flex-col items-center gap-1.5 py-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Rest</span>
        <div className="relative w-20 h-20">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(var(--secondary))" strokeWidth="4" />
            <circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 34}
              strokeDashoffset={2 * Math.PI * 34 * (1 - progress)}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-lg font-bold text-foreground tabular-nums">{timeStr}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={skip} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
            Skip
          </button>
          <button onClick={extend} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
            +30s
          </button>
        </div>
      </div>
    );
  }

  // Inline variant (inside set row)
  if (!isActive && remaining === 0) {
    return (
      <button
        onClick={startManually}
        className="w-7 h-7 rounded-md flex items-center justify-center bg-secondary/60 text-muted-foreground hover:text-primary transition-colors"
        title="Start rest timer"
      >
        <Timer className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <button
      onClick={skip}
      className="w-full h-7 rounded-md flex items-center justify-center bg-primary/10 text-primary text-[10px] font-mono font-bold tabular-nums animate-pulse"
      title="Tap to skip"
    >
      {timeStr}
    </button>
  );
};
