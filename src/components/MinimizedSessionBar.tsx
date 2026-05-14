import React, { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Shared with the page-content wrapper in Index.tsx so the spacer always
// matches the bar's intrinsic height. Excludes env(safe-area-inset-bottom),
// which is added separately by both consumers.
export const MINIMIZED_BAR_HEIGHT = 64;

interface MinimizedSessionBarProps {
  workoutName: string;
  startTimestamp?: number | null;
  onExpand: () => void;
  onDiscard: () => void;
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export const MinimizedSessionBar: React.FC<MinimizedSessionBarProps> = ({
  workoutName, startTimestamp, onExpand, onDiscard,
}) => {
  const [now, setNow] = useState(() => Date.now());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!startTimestamp) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTimestamp]);

  const elapsed = startTimestamp ? formatElapsed((now - startTimestamp) / 1000) : null;

  return (
    <>
      <div
        style={{ paddingBottom: `calc(0.5rem + env(safe-area-inset-bottom))` }}
        className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto bg-primary text-primary-foreground px-3 pt-2 flex items-center gap-2 shadow-lg rounded-t-xl"
      >
        <button
          type="button"
          onClick={onExpand}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-label="Resume workout"
        >
          <Timer className="w-4 h-4 animate-pulse shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-sm truncate">
              {workoutName || 'Workout'} in progress
            </span>
            {elapsed && (
              <span className="font-mono text-xs opacity-80">{elapsed}</span>
            )}
          </div>
        </button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExpand}
          className="h-8 px-3 shrink-0"
        >
          Resume
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          className="h-8 px-3 shrink-0 bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          Discard
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Workout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard this workout? All progress will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmOpen(false); onDiscard(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
