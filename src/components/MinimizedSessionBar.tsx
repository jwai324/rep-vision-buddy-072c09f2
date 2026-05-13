import React from 'react';
import { ChevronUp, Timer } from 'lucide-react';

// Shared with the page-content wrapper in Index.tsx so the spacer always
// matches the bar's intrinsic height. Excludes env(safe-area-inset-bottom),
// which is added separately by both consumers.
export const MINIMIZED_BAR_HEIGHT = 56;

interface MinimizedSessionBarProps {
  workoutName: string;
  onExpand: () => void;
}

export const MinimizedSessionBar: React.FC<MinimizedSessionBarProps> = ({ workoutName, onExpand }) => {
  return (
    <button
      onClick={onExpand}
      style={{ paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom))` }}
      className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto bg-primary text-primary-foreground px-4 pt-3 flex items-center justify-between shadow-lg rounded-t-xl"
    >
      <div className="flex items-center gap-2">
        <Timer className="w-4 h-4 animate-pulse" />
        <span className="font-semibold text-sm">{workoutName || 'Workout'} in progress</span>
      </div>
      <ChevronUp className="w-5 h-5" />
    </button>
  );
};
