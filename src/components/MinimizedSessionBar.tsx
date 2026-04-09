import React from 'react';
import { ChevronUp, Timer } from 'lucide-react';

interface MinimizedSessionBarProps {
  workoutName: string;
  onExpand: () => void;
}

export const MinimizedSessionBar: React.FC<MinimizedSessionBarProps> = ({ workoutName, onExpand }) => {
  return (
    <button
      onClick={onExpand}
      className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between shadow-lg rounded-t-xl"
    >
      <div className="flex items-center gap-2">
        <Timer className="w-4 h-4 animate-pulse" />
        <span className="font-semibold text-sm">{workoutName || 'Workout'} in progress</span>
      </div>
      <ChevronUp className="w-5 h-5" />
    </button>
  );
};
