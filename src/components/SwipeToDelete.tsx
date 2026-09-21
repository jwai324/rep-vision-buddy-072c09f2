import React, { useRef, useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';

interface SwipeToDeleteProps {
  onDelete: () => void;
  /**
   * Accessible name for the remove button, naming the row it removes
   * ("Remove set 2 in Bench Press"). The swipe below binds touch handlers
   * only, so on a laptop — and for anyone using a keyboard or a screen
   * reader — this button is the only way to remove a row at all. It is
   * revealed on hover and on keyboard focus rather than shown always, so it
   * never crowds the inputs and the tick on a phone-width row.
   */
  removeLabel: string;
  children: React.ReactNode;
  className?: string;
}

const THRESHOLD = 120;

export const SwipeToDelete: React.FC<SwipeToDeleteProps> = ({ onDelete, removeLabel, children, className = '' }) => {
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
    <div className={`group relative overflow-hidden ${className}`}>
      {/* Delete background */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-3 bg-destructive rounded-md"
        style={{ width: `${Math.max(offsetX, 0)}px` }}
      >
        {offsetX > 60 && <Trash2 className="w-4 h-4 text-destructive-foreground" />}
      </div>
      {/* Sits over the set-number column, the one cell of the row that holds
          no control, so revealing it cannot cover a tap target. The reveal is
          gated on [@media(hover:hover)] — a bare group-hover: is what a touch
          browser applies on tap (sticky hover, on the tapped element and every
          ancestor), which would arm this button under the thumb of whoever
          just used the row's own controls. The media query, not
          pointer-events-none, is what keeps a phone away from it; the
          focus-visible pair is left ungated so Tab still reaches it. */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={removeLabel}
        className="absolute left-0 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md bg-background text-muted-foreground opacity-0 pointer-events-none transition-opacity hover:text-destructive [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
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
