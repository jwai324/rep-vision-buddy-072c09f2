import React, { useRef, useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
}

const THRESHOLD = 80;

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
    setOffsetX(Math.max(0, Math.min(diff, 120)));
  }, [swiping]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offsetX >= THRESHOLD) {
      onDelete();
    }
    setOffsetX(0);
  }, [offsetX, onDelete]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Delete background */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-3 bg-destructive rounded-md"
        style={{ width: `${Math.max(offsetX, 0)}px` }}
      >
        {offsetX > 40 && <Trash2 className="w-4 h-4 text-destructive-foreground" />}
      </div>
      {/* Content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(-${offsetX}px)`, transition: swiping ? 'none' : 'transform 0.2s ease-out' }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
};
