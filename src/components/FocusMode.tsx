import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowLeft, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ExerciseTable,
  type ExerciseBlock,
  type SetRow,
  type DropRow,
  type RunningSetState,
  type PersistedTimer,
} from '@/components/ActiveSession';
import type { TimerId } from '@/components/ExerciseRestTimer';
import type { WeightUnit } from '@/hooks/useStorage';
import type { ExerciseInputMode } from '@/utils/exerciseInputMode';

interface FocusModeProps {
  blocks: ExerciseBlock[];
  weightUnit: WeightUnit;
  activeTimer: PersistedTimer | null;
  restRecords: Record<string, number>;
  runningSet: RunningSetState | null;
  getStickyNote: (exerciseId: string) => string;
  getPreviousSets: (exerciseId: string) => { weight?: number; reps: number; rpe?: number; time?: number }[];
  getInputMode: (exerciseId: string) => ExerciseInputMode;
  onUpdateSet: (blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => void;
  onToggleComplete: (blockIdx: number, setIdx: number) => void;
  onAddSet: (blockIdx: number) => void;
  onAddDrop: (blockIdx: number, setIdx: number) => void;
  onUpdateDrop: (blockIdx: number, setIdx: number, dropIdx: number, field: keyof DropRow, value: string | boolean) => void;
  onRemoveSet: (blockIdx: number, setIdx: number) => void;
  onRemoveDrop: (blockIdx: number, setIdx: number, dropIdx: number) => void;
  onMenuAction: (action: string, blockIdx: number) => void;
  onStartTimer: (id: TimerId, duration: number) => void;
  onSkipTimer: () => void;
  onExtendTimer: (delta?: number) => void;
  onStartNextSet: (blockIdx: number) => void;
  onStopSet: () => void;
  onClose: () => void;
  scrollToBlock: (idx: number | null) => void;
}

/** A set is "fully complete" only if its parent and ALL its drops are completed. */
function isSetFullyComplete(set: SetRow): boolean {
  if (!set.completed) return false;
  return (set.drops ?? []).every(d => d.completed);
}

function blockHasIncomplete(block: ExerciseBlock): boolean {
  return block.sets.some(s => !isSetFullyComplete(s));
}

function completedRounds(block: ExerciseBlock): number {
  let n = 0;
  for (const s of block.sets) {
    if (isSetFullyComplete(s)) n += 1;
    else break;
  }
  return n;
}

/**
 * Pick the next exercise to focus on.
 * - If a superset group has any incomplete sets, cycle within it by picking
 *   the block with the fewest fully-completed leading rounds.
 * - Otherwise pick the first block with any incomplete set.
 */
export function pickFocusedBlockIdx(blocks: ExerciseBlock[]): number | null {
  // 1. Find lowest superset group with incomplete work.
  const groups = new Map<number, number[]>();
  blocks.forEach((b, i) => {
    if (b.supersetGroup === undefined) return;
    if (!groups.has(b.supersetGroup)) groups.set(b.supersetGroup, []);
    groups.get(b.supersetGroup)!.push(i);
  });
  const sortedGroupIds = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const gid of sortedGroupIds) {
    const idxs = groups.get(gid)!;
    const incomplete = idxs.filter(i => blockHasIncomplete(blocks[i]));
    if (incomplete.length === 0) continue;
    let best = incomplete[0];
    let bestRounds = completedRounds(blocks[best]);
    for (const i of incomplete.slice(1)) {
      const r = completedRounds(blocks[i]);
      if (r < bestRounds) {
        best = i;
        bestRounds = r;
      }
    }
    return best;
  }
  // 2. No active superset → first block with any incomplete set.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.supersetGroup !== undefined) continue; // handled above
    if (blockHasIncomplete(b)) return i;
  }
  // 3. Fallback: any block at all with incomplete (covers edge cases).
  for (let i = 0; i < blocks.length; i++) {
    if (blockHasIncomplete(blocks[i])) return i;
  }
  return null;
}

export const FocusMode: React.FC<FocusModeProps> = (props) => {
  const { blocks, onClose, scrollToBlock } = props;
  const focusedIdx = useMemo(() => pickFocusedBlockIdx(blocks), [blocks]);
  const block = focusedIdx !== null ? blocks[focusedIdx] : null;

  // Transition: when the focused block changes, briefly dim Focus Mode
  // and reveal the underlying ActiveSession scrolled to the new block.
  const previousFocusedIdx = useRef<number | null>(focusedIdx);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousFocusedIdx.current !== null && previousFocusedIdx.current !== focusedIdx) {
      setIsTransitioning(true);
      scrollToBlock(focusedIdx);
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current);
      }
      transitionTimeoutRef.current = window.setTimeout(() => {
        setIsTransitioning(false);
        transitionTimeoutRef.current = null;
      }, 900);
    }
    previousFocusedIdx.current = focusedIdx;
    return () => {
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, [focusedIdx, scrollToBlock]);

  // Compute superset position label, if any.
  const supersetLabel = useMemo(() => {
    if (!block || block.supersetGroup === undefined || focusedIdx === null) return null;
    const groupIdxs = blocks
      .map((b, i) => (b.supersetGroup === block.supersetGroup ? i : -1))
      .filter(i => i >= 0);
    const pos = groupIdxs.indexOf(focusedIdx) + 1;
    return `Superset ${String.fromCharCode(64 + pos)} of ${groupIdxs.length}`;
  }, [blocks, block, focusedIdx]);

  const totalSets = block?.sets.length ?? 0;
  const currentRound = block ? completedRounds(block) + 1 : 0;
  const setLabel = block && currentRound <= totalSets ? `Set ${currentRound} of ${totalSets}` : null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-background overflow-y-auto pb-24 transition-opacity duration-300',
        isTransitioning && 'opacity-30 pointer-events-none'
      )}
    >
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Close
        </button>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">Focus Mode</div>
        <div className="w-12" />
      </div>

      {block && focusedIdx !== null ? (
        <>
          {/* Animation region */}
          <div className="relative px-4 pt-4">
            {/* TODO: replace with <ExerciseAnimation exerciseName={block.exerciseName} /> once wired */}
            <div className="relative w-full rounded-2xl bg-secondary/40 flex items-center justify-center" style={{ height: '40vh' }}>
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Sparkles className="w-10 h-10 opacity-50" />
                <span className="text-xs uppercase tracking-wider">Animation</span>
              </div>
              {/* Soft fade into the page below */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background rounded-b-2xl" />
            </div>
          </div>

          {/* Exercise name + meta */}
          <div className="px-4 pt-4">
            <h2 className="text-2xl font-bold text-foreground leading-tight">{block.exerciseName}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {setLabel && <span>{setLabel}</span>}
              {setLabel && supersetLabel && <span>•</span>}
              {supersetLabel && <span className="text-primary font-medium">{supersetLabel}</span>}
            </div>
          </div>

          {/* Reused ExerciseTable for the focused block */}
          <div className="px-4 pt-4">
            <ExerciseTable
              block={block}
              blockIdx={focusedIdx}
              weightUnit={props.weightUnit}
              blocks={blocks}
              stickyNote={props.getStickyNote(block.exerciseId)}
              activeTimer={props.activeTimer}
              restRecords={props.restRecords}
              previousSets={props.getPreviousSets(block.exerciseId)}
              inputMode={props.getInputMode(block.exerciseId)}
              onUpdateSet={props.onUpdateSet}
              onToggleComplete={props.onToggleComplete}
              onAddSet={props.onAddSet}
              onAddDrop={props.onAddDrop}
              onUpdateDrop={props.onUpdateDrop}
              onRemoveSet={props.onRemoveSet}
              onRemoveDrop={props.onRemoveDrop}
              onMenuAction={props.onMenuAction}
              onStartTimer={props.onStartTimer}
              onSkipTimer={props.onSkipTimer}
              onExtendTimer={props.onExtendTimer}
              runningSet={props.runningSet}
              onStartNextSet={props.onStartNextSet}
              onStopSet={props.onStopSet}
            />
          </div>
        </>
      ) : (
        // Workout complete state
        <div className="flex flex-col items-center justify-center text-center px-6 py-24 gap-4">
          <CheckCircle2 className="w-16 h-16 text-primary" />
          <h2 className="text-2xl font-bold text-foreground">Workout complete</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            All sets done. Close Focus Mode and tap Finish to save your workout.
          </p>
          <Button variant="neon" onClick={onClose} className="mt-2">
            Back to Workout
          </Button>
        </div>
      )}
    </div>
  );
};
