import React from 'react';

interface RepCounterDisplayProps {
  reps: number;
  animKey?: number;
}

export const RepCounterDisplay: React.FC<RepCounterDisplayProps> = ({ reps, animKey }) => {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Reps</span>
      <div
        key={animKey ?? reps}
        className="font-mono text-7xl font-extrabold text-primary glow-green-text animate-count-up tabular-nums"
      >
        {reps}
      </div>
    </div>
  );
};
