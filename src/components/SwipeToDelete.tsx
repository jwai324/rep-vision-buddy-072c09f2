import React, { useRef, useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
}

const THRESHOLD = 120;

export const SwipeToDelete: React.FC<SwipeToDeleteProps> = ({ onDelete, children, className = '' }) => {
  const startX = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;
    const diff = startX.current - e.touches[0].clientX;
    setOffsetX(Math.max(0, Math.min(diff, 160)));
  }, [swiping]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offsetX >= THRESHOLD) {
      onDelete();
    }
    setOffsetX(0);
  }, [offsetX, onDelete]);

  // Once the browser decides the gesture is a scroll it takes the touch and
  // ends it with touchcancel, not touchend; the row stayed translated with
  // the delete strip showing until the next touch.
  const handleTouchCancel = useCallback(() => {
    setSwiping(false);
    setOffsetX(0);
  }, []);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Delete background */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-3 bg-destructive rounded-md"
        style={{ width: `${Math.max(offsetX, 0)}px` }}
      >
        {offsetX > 60 && <Trash2 className="w-4 h-4 text-destructive-foreground" />}
      </div>
      {/* Content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        style={{ transform: `translateX(-${offsetX}px)`, transition: swiping ? 'none' : 'transform 0.2s ease-out' }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
};
