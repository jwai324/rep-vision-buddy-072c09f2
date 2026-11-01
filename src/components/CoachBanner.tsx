import React, { useState } from 'react';
import { ChevronDown, LogOut, Timer, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useCoach, type ActingAs } from '@/contexts/CoachContext';
import { MINIMIZED_BAR_HEIGHT } from '@/components/MinimizedSessionBar';
import { clientLabel } from '@/utils/clientLabel';

/**
 * "Coaching <name>" while a coach acts as a client. In normal flow, not fixed:
 * a fixed bar would cover every screen's back button. It spans the viewport
 * and leaves its centre empty, which is where the bug-report handle hangs.
 */
export const CoachBanner: React.FC<{
  onSwitch: (client: ActingAs | null) => void;
}> = ({ onSwitch }) => {
  const { actingAs, clients } = useCoach();
  if (!actingAs) return null;
  const others = clients.filter(c => c.clientId !== actingAs.clientId);
  return (
    <div
      role="status"
      className="sticky top-0 z-30 w-full grid grid-cols-[1fr_76px_1fr] items-center h-9 px-3 bg-amber-500 text-amber-950 text-xs font-medium shadow-sm"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex items-center gap-1 min-w-0 text-left" aria-label="Switch account">
            <UserRound className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Coaching {clientLabel(actingAs.displayName)}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Switch to</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSwitch(null)}>My account</DropdownMenuItem>
          {others.length > 0 && <DropdownMenuSeparator />}
          {others.map(c => (
            <DropdownMenuItem
              key={c.clientId}
              onSelect={() => onSwitch({ clientId: c.clientId, displayName: c.displayName })}
            >
              <span className="truncate">{clientLabel(c.displayName)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSwitch(null)}
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-amber-600/30"
        >
          <LogOut className="w-3.5 h-3.5" />
          Exit
        </button>
      </div>
    </div>
  );
};

/**
 * A line along the top edge while acting as a client, above the full-screen
 * overlays (Focus Mode z-60, the workout summary z-50) that cover the banner,
 * so the coach can tell whose workout they are logging. Below dialogs (z-70).
 */
export const CoachFrame: React.FC = () => {
  const { actingAs } = useCoach();
  if (!actingAs) return null;
  return <div aria-hidden className="fixed top-0 inset-x-0 h-[3px] bg-amber-500 z-[65] pointer-events-none" />;
};

/**
 * The workout in progress on this device belongs to another account than the
 * one on screen — another tab left in the other identity, or a client who
 * ended the link mid-workout. It is never resumed, restored or auto-saved
 * here; the coach goes back to its account, or decides what becomes of it
 * when that account is out of reach.
 */
export const ForeignWorkoutBar: React.FC<{
  workoutName: string;
  ownerName: string;
  onSwitch?: () => void;
  onKeep?: () => void;
  onDiscard: () => void;
}> = ({ workoutName, ownerName, onSwitch, onKeep, onDiscard }) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <div
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))', minHeight: MINIMIZED_BAR_HEIGHT }}
        className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto bg-amber-500 text-amber-950 px-3 pt-2 flex items-center gap-2 shadow-lg rounded-t-xl"
      >
        <Timer className="w-4 h-4 shrink-0" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-semibold text-sm truncate">{workoutName || 'Workout'} in progress</span>
          <span className="text-xs opacity-80 truncate">for {ownerName}</span>
        </div>
        {onSwitch && (
          <Button size="sm" variant="secondary" className="h-8 px-3 shrink-0" onClick={onSwitch}>
            Switch
          </Button>
        )}
        {onKeep && (
          <Button size="sm" variant="secondary" className="h-8 px-3 shrink-0" onClick={onKeep}>
            Keep
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3 shrink-0 bg-transparent border-amber-950/30 text-amber-950 hover:bg-amber-600/30"
          onClick={() => setConfirmOpen(true)}
        >
          Discard
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              The workout in progress for {ownerName} will be lost.
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
