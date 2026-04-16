import React from 'react';

interface RestTimerRingProps {
  remaining: number;
  progress: number;
  onSkip: () => void;
  onExtend: (delta?: number) => void;
}

export const RestTimerRing: React.FC<RestTimerRingProps> = ({ remaining, progress, onSkip, onExtend }) => {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">Rest</span>
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--surface-3))" strokeWidth="6" />
          <circle
            cx="60" cy="60" r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-3xl font-bold text-foreground tabular-nums">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onSkip} className="px-4 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
          Skip
        </button>
        <button onClick={onExtend} className="px-4 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
          +30s
        </button>
      </div>
    </div>
  );
};
