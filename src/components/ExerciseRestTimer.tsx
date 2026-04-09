import React from 'react';
import { Timer } from 'lucide-react';

export interface TimerId {
  type: 'set' | 'between';
  blockIdx: number;
  setIdx?: number;
}

interface ExerciseRestTimerProps {
  timerId: TimerId;
  defaultDuration: number;
  variant?: 'inline' | 'between';
  /** Whether this specific timer is currently the active one */
  isActive: boolean;
  /** Remaining seconds (only meaningful when isActive) */
  remaining: number;
  /** Total duration of the active timer */
  totalDuration: number;
  /** Recorded rest time after completion (seconds), or null */
  recordedRest: number | null;
  onStart: (id: TimerId, duration: number) => void;
  onSkip: () => void;
  onExtend: () => void;
}

export const ExerciseRestTimer: React.FC<ExerciseRestTimerProps> = ({
  timerId, defaultDuration, variant = 'inline',
  isActive, remaining, totalDuration, recordedRest,
  onStart, onSkip, onExtend,
}) => {
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const formatRecorded = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (variant === 'between') {
    // Show recorded rest
    if (!isActive && recordedRest !== null) {
      return (
        <div className="flex items-center justify-center py-2">
          <button
            onClick={() => onStart(timerId, defaultDuration)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-xs text-primary font-mono tabular-nums"
          >
            <Timer className="w-3 h-3" />
            {formatRecorded(recordedRest)}
          </button>
        </div>
      );
    }

    if (!isActive) {
      return (
        <div className="flex items-center justify-center py-2">
          <button
            onClick={() => onStart(timerId, defaultDuration)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/40 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <Timer className="w-3 h-3" />
            Start Rest
          </button>
        </div>
      );
    }

    const progress = totalDuration > 0 ? (totalDuration - remaining) / totalDuration : 0;

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
          <button onClick={onSkip} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
            Skip
          </button>
          <button onClick={onExtend} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
            +30s
          </button>
        </div>
      </div>
    );
  }

  // Inline variant
  // Show recorded rest
  if (!isActive && recordedRest !== null) {
    return (
      <button
        onClick={() => onStart(timerId, defaultDuration)}
        className="w-7 h-7 rounded-md flex items-center justify-center bg-primary/10 text-primary text-[9px] font-mono font-bold tabular-nums"
        title="Rest completed – tap to restart"
      >
        {formatRecorded(recordedRest)}
      </button>
    );
  }

  if (!isActive) {
    return (
      <button
        onClick={() => onStart(timerId, defaultDuration)}
        className="w-7 h-7 rounded-md flex items-center justify-center bg-secondary/60 text-muted-foreground hover:text-primary transition-colors"
        title="Start rest timer"
      >
        <Timer className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <button
      onClick={onSkip}
      className="w-full h-7 rounded-md flex items-center justify-center bg-primary/10 text-primary text-[10px] font-mono font-bold tabular-nums animate-pulse"
      title="Tap to skip"
    >
      {timeStr}
    </button>
  );
};
