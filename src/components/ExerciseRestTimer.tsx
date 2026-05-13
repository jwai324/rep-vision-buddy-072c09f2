import React from 'react';
import { Timer } from 'lucide-react';

export interface TimerId {
  type: 'set' | 'between';
  blockIdx: number;
  setIdx?: number;
  dropIdx?: number;
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
  onExtend: (delta?: number) => void;
}

export const ExerciseRestTimer: React.FC<ExerciseRestTimerProps> = ({
  timerId, defaultDuration, variant = 'inline',
  isActive, remaining, totalDuration, recordedRest,
  onStart, onSkip, onExtend,
}) => {
  const isOvertime = remaining < 0;
  const absRemaining = Math.abs(remaining);
  const minutes = Math.floor(absRemaining / 60);
  const seconds = absRemaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const formatRecorded = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (variant === 'between') {
    // Show recorded rest — full-width subtle bar
    if (!isActive && recordedRest !== null) {
      return (
        <button
          onClick={() => onStart(timerId, defaultDuration)}
          className="relative w-full h-8 rounded-md overflow-hidden bg-primary/5 my-0.5 flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
        >
          <Timer className="w-3 h-3 text-primary" />
          <span className="text-xs text-primary font-mono font-bold tabular-nums">
            {formatRecorded(recordedRest)}
          </span>
        </button>
      );
    }

    if (!isActive) {
      return (
        <button
          onClick={() => onStart(timerId, defaultDuration)}
          className="w-full h-8 rounded-md bg-secondary/20 my-0.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
        >
          <Timer className="w-3 h-3" />
          Start Rest
        </button>
      );
    }

    const progress = totalDuration > 0 ? Math.min(1, (totalDuration - remaining) / totalDuration) : 0;
    const barFill = isOvertime ? 'bg-destructive/25' : 'bg-primary/20';
    const labelText = isOvertime ? 'Overtime' : 'Rest';
    const timeColor = isOvertime ? 'text-destructive' : 'text-foreground';

    return (
      <div className="relative w-full h-10 rounded-md overflow-hidden bg-secondary/30 my-1">
        <div
          className={`absolute inset-y-0 left-0 ${barFill} transition-all duration-1000 ease-linear`}
          style={{ width: `${progress * 100}%` }}
        />
        <div className="relative flex items-center justify-between px-3 h-full">
          <span className={`text-[10px] uppercase tracking-widest ${isOvertime ? 'text-destructive' : 'text-muted-foreground'}`}>{labelText}</span>
          <span className={`font-mono text-sm font-bold tabular-nums ${timeColor}`}>{timeStr}</span>
          <div className="flex gap-2">
            <button aria-label="Skip rest timer" onClick={onSkip} className="px-2.5 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
              Skip
            </button>
            <button aria-label="Subtract 30 seconds" onClick={() => onExtend(-30)} className="px-2.5 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
              -30s
            </button>
            <button aria-label="Add 30 seconds" onClick={() => onExtend(30)} className="px-2.5 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
              +30s
            </button>
          </div>
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
      className={`w-full h-7 rounded-md flex items-center justify-center text-[10px] font-mono font-bold tabular-nums animate-pulse ${
        isOvertime ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary'
      }`}
      title="Tap to skip"
    >
      {isOvertime ? `+${timeStr}` : timeStr}
    </button>
  );
};
