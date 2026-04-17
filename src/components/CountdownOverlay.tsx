import React, { useEffect, useState } from 'react';

interface CountdownOverlayProps {
  from?: number;
  onComplete: () => void;
  onCancel?: () => void;
}

/**
 * Full-screen semi-transparent countdown (5..1) overlay used to delay the
 * start of a timed set. Calls onComplete when the count reaches 0.
 */
export const CountdownOverlay: React.FC<CountdownOverlayProps> = ({ from = 5, onComplete, onCancel }) => {
  const [n, setN] = useState(from);

  useEffect(() => {
    if (n <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setN(n - 1), 1000);
    return () => clearTimeout(t);
  }, [n, onComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex flex-col items-center justify-center select-none">
      <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-4">
        Get Ready
      </div>
      <div
        key={n}
        className="text-[180px] leading-none font-black text-primary animate-pulse"
        style={{ textShadow: '0 0 40px hsl(var(--primary) / 0.5)' }}
      >
        {n > 0 ? n : 'GO'}
      </div>
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-12 px-6 py-2 rounded-full bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
};
