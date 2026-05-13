import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
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
import { distanceUnitFromWeightUnit, type ExerciseInputMode } from '@/utils/exerciseInputMode';

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
}

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

export function pickFocusedBlockIdx(blocks: ExerciseBlock[]): number | null {
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
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.supersetGroup !== undefined) continue;
    if (blockHasIncomplete(b)) return i;
  }
  for (let i = 0; i < blocks.length; i++) {
    if (blockHasIncomplete(blocks[i])) return i;
  }
  return null;
}

interface NextExerciseInfo {
  name: string;
  weight: string;
  reps: string;
}

function computeNextInfo(blocks: ExerciseBlock[], focusedIdx: number | null): NextExerciseInfo | null {
  if (focusedIdx === null) return null;
  const synthetic = blocks.map((b, i) =>
    i === focusedIdx
      ? {
          ...b,
          sets: b.sets.map(s => ({
            ...s,
            completed: true,
            drops: (s.drops ?? []).map(d => ({ ...d, completed: true })),
          })),
        }
      : b
  );
  const nextIdx = pickFocusedBlockIdx(synthetic);
  if (nextIdx === null || nextIdx === focusedIdx) return null;
  const nextBlock = blocks[nextIdx];
  const nextSet = nextBlock.sets.find(s => !isSetFullyComplete(s));
  return {
    name: nextBlock.exerciseName,
    weight: nextSet?.weight ?? '',
    reps: nextSet?.reps ?? '',
  };
}

type Phase = 'idle' | 'promoting' | 'revealing';

const PROMOTE_MS = 500;
const REVEAL_MS = 300;

export const FocusMode: React.FC<FocusModeProps> = (props) => {
  const { blocks, onClose } = props;
  const targetIdx = useMemo(() => pickFocusedBlockIdx(blocks), [blocks]);

  // The block currently rendered as the "displayed" focused one.
  // Updated only after promotion finishes so the outgoing block stays put
  // (faded) while the new name flies into place.
  const [displayedIdx, setDisplayedIdx] = useState<number | null>(targetIdx);
  const [phase, setPhase] = useState<Phase>('idle');
  const [flyTransform, setFlyTransform] = useState<string>('');
  const [flyAtTarget, setFlyAtTarget] = useState(false);
  const [promotingName, setPromotingName] = useState<string | null>(null);

  const titleSlotRef = useRef<HTMLHeadingElement | null>(null);
  const upNextSlotRef = useRef<HTMLDivElement | null>(null);
  const previousTargetRef = useRef<number | null>(targetIdx);
  const timersRef = useRef<number[]>([]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const clearTimers = () => {
    timersRef.current.forEach(t => window.clearTimeout(t));
    timersRef.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  // Trigger promotion when target changes.
  useLayoutEffect(() => {
    const prev = previousTargetRef.current;
    previousTargetRef.current = targetIdx;
    if (prev === null || prev === targetIdx) {
      // First mount or no change — just sync displayed.
      if (displayedIdx !== targetIdx) setDisplayedIdx(targetIdx);
      return;
    }

    // No next exercise (workout complete): skip promotion.
    if (targetIdx === null) {
      clearTimers();
      setPhase('idle');
      setPromotingName(null);
      setDisplayedIdx(null);
      return;
    }

    const startEl = upNextSlotRef.current;
    const endEl = titleSlotRef.current;
    const newName = blocksRef.current[targetIdx]?.exerciseName ?? '';

    if (!startEl || !endEl) {
      // Can't measure — snap.
      setDisplayedIdx(targetIdx);
      setPhase('idle');
      return;
    }

    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();
    // FLIP: floating clone is positioned at end (title) location with end styling.
    // We start it transformed back to the start (upNext) location with start styling,
    // then transition to identity transform + end styling.
    const dx = startRect.left - endRect.left;
    const dy = startRect.top - endRect.top;
    // Scale so the clone visually matches the upNext font size on start.
    // Start font ≈ text-base (~16px), end ≈ text-3xl/4xl (~30-36px). Use height ratio.
    const scale = Math.max(0.1, startRect.height / Math.max(1, endRect.height));

    clearTimers();
    setPromotingName(newName);
    setFlyTransform(`translate(${dx}px, ${dy}px) scale(${scale})`);
    setFlyAtTarget(false);
    setPhase('promoting');

    // Next frame: animate to identity.
    const raf = window.requestAnimationFrame(() => {
      setFlyTransform('translate(0px, 0px) scale(1)');
      setFlyAtTarget(true);
    });

    const t1 = window.setTimeout(() => {
      // Promotion done: commit new displayed block, reveal phase.
      setDisplayedIdx(targetIdx);
      setPhase('revealing');
      setPromotingName(null);
    }, PROMOTE_MS);

    const t2 = window.setTimeout(() => {
      setPhase('idle');
    }, PROMOTE_MS + REVEAL_MS);

    timersRef.current = [t1, t2];
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [targetIdx]);

  const block = displayedIdx !== null ? blocks[displayedIdx] : null;

  const supersetLabel = useMemo(() => {
    if (!block || block.supersetGroup === undefined || displayedIdx === null) return null;
    // Determine the ordinal of this superset GROUP (A for first group, B for second, etc.)
    const uniqueGroups = Array.from(new Set(
      blocks.filter(b => b.supersetGroup !== undefined).map(b => b.supersetGroup as number)
    )).sort((a, b) => a - b);
    const groupOrdinal = uniqueGroups.indexOf(block.supersetGroup) + 1;
    const groupIdxs = blocks
      .map((b, i) => (b.supersetGroup === block.supersetGroup ? i : -1))
      .filter(i => i >= 0);
    const posInGroup = groupIdxs.indexOf(displayedIdx) + 1;
    return `Superset ${String.fromCharCode(64 + groupOrdinal)} · ${posInGroup} of ${groupIdxs.length}`;
  }, [blocks, block, displayedIdx]);

  const totalSets = block?.sets.length ?? 0;
  const currentRound = block ? completedRounds(block) + 1 : 0;
  const setLabel = block && currentRound <= totalSets ? `Set ${currentRound} of ${totalSets}` : null;

  const nextInfo = useMemo(
    () => computeNextInfo(blocks, displayedIdx),
    [blocks, displayedIdx]
  );

  // Visual flags
  const isPromoting = phase === 'promoting';
  const isRevealing = phase === 'revealing';
  // During promoting: outgoing block contents fade out; title hidden so clone is the only name on screen.
  const contentOpacityClass = isPromoting ? 'opacity-0' : 'opacity-100';
  // During promoting we still render the previous block (frozen), but blank the title slot
  // so the floating clone is unambiguous.
  const titleVisible = !isPromoting;

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto pb-24">
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

      {block && displayedIdx !== null ? (
        <div className={cn('transition-opacity', isRevealing && 'animate-fade-in')}>
          {/* Animation region */}
          <div
            className={cn('relative px-4 pt-4 transition-opacity duration-300', contentOpacityClass)}
          >
            <div className="relative w-full rounded-2xl bg-secondary/40 flex items-center justify-center" style={{ height: '40vh' }}>
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Sparkles className="w-10 h-10 opacity-50" />
                <span className="text-xs uppercase tracking-wider">Animation</span>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background rounded-b-2xl" />
            </div>
          </div>

          {/* Exercise name + meta */}
          <div className="px-4 pt-4">
            <h2
              ref={titleSlotRef}
              className={cn(
                'text-3xl sm:text-4xl font-bold text-foreground leading-tight transition-opacity duration-200',
                titleVisible ? 'opacity-100' : 'opacity-0'
              )}
            >
              {block.exerciseName}
            </h2>
            <div
              className={cn(
                'mt-1 flex items-center gap-2 text-xs text-muted-foreground transition-opacity duration-300',
                contentOpacityClass
              )}
            >
              {setLabel && <span>{setLabel}</span>}
              {setLabel && supersetLabel && <span>•</span>}
              {supersetLabel && <span className="text-primary font-medium">{supersetLabel}</span>}
            </div>
          </div>

          {/* Reused ExerciseTable */}
          <div className={cn('px-4 pt-4 transition-opacity duration-300', contentOpacityClass)}>
            <ExerciseTable
              block={block}
              blockIdx={displayedIdx}
              weightUnit={props.weightUnit}
              distanceUnit={distanceUnitFromWeightUnit(props.weightUnit)}
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
              hideHeaderName
            />
          </div>

          {/* Up next footer */}
          {nextInfo && (
            <div
              className={cn(
                'px-4 pt-8 pb-4 transition-opacity duration-300',
                contentOpacityClass
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Up next</div>
              <div
                ref={upNextSlotRef}
                className="mt-1 text-base font-medium text-muted-foreground inline-block"
              >
                {nextInfo.name}
                {(nextInfo.weight || nextInfo.reps) && (
                  <span className="ml-2 text-sm font-normal">
                    {nextInfo.weight ? `${nextInfo.weight}${props.weightUnit === 'lbs' ? 'lbs' : 'kg'}` : ''}
                    {nextInfo.weight && nextInfo.reps ? ' × ' : ''}
                    {nextInfo.reps || ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-center px-6 py-24 gap-4 animate-fade-in">
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

      {/* Floating rest timer pill — bottom right */}
      <FloatingRestTimer
        activeTimer={props.activeTimer}
        onSkip={props.onSkipTimer}
        onExtend={props.onExtendTimer}
      />

      {/* Floating promoted name clone — positioned over the title slot,
          starts transformed back to the upNext slot and animates to identity. */}
      {isPromoting && promotingName && titleSlotRef.current && (
        <FloatingPromotedName
          name={promotingName}
          targetRect={titleSlotRef.current.getBoundingClientRect()}
          transform={flyTransform}
          atTarget={flyAtTarget}
        />
      )}
    </div>
  );
};

interface FloatingPromotedNameProps {
  name: string;
  targetRect: DOMRect;
  transform: string;
  atTarget: boolean;
}

const FloatingPromotedName: React.FC<FloatingPromotedNameProps> = ({
  name,
  targetRect,
  transform,
  atTarget,
}) => {
  return (
    <div
      className="fixed z-[60] pointer-events-none"
      style={{
        left: targetRect.left,
        top: targetRect.top,
        transform,
        transformOrigin: 'top left',
        transition: `transform ${PROMOTE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        willChange: 'transform',
      }}
    >
      <h2
        className={cn(
          'font-bold leading-tight whitespace-nowrap transition-colors duration-300',
          'text-3xl sm:text-4xl',
          atTarget ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {name}
      </h2>
    </div>
  );
};

/* ── Floating Rest Timer ─────────────────────────────────────── */

interface FloatingRestTimerProps {
  activeTimer: PersistedTimer | null;
  onSkip: () => void;
  onExtend: (delta?: number) => void;
}

const FloatingRestTimer: React.FC<FloatingRestTimerProps> = ({ activeTimer, onSkip, onExtend }) => {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!activeTimer || activeTimer.status !== 'running') {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const r = Math.max(0, Math.ceil((activeTimer.startedAtEpoch + activeTimer.duration * 1000 - Date.now()) / 1000));
      setRemaining(r);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  if (!activeTimer || activeTimer.status !== 'running' || remaining <= 0) return null;

  const progress = Math.max(0, Math.min(1, 1 - remaining / Math.max(1, activeTimer.originalDuration)));
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="fixed bottom-6 right-4 z-[55] flex flex-col items-center gap-1.5 animate-fade-in">
      <div className="relative w-14 h-14 bg-card/95 backdrop-blur border border-border rounded-full shadow-lg flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={radius} fill="none" stroke="hsl(var(--surface-3))" strokeWidth="3" />
          <circle
            cx="28" cy="28" r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <span className="font-mono text-xs font-bold text-foreground tabular-nums z-10">
          {mins}:{secs.toString().padStart(2, '0')}
        </span>
      </div>
      <div className="flex gap-1">
        <button
          onClick={onSkip}
          className="px-2 py-0.5 rounded-md bg-secondary/90 text-secondary-foreground text-[10px] font-medium hover:bg-secondary transition-colors"
        >
          Skip
        </button>
        <button
          onClick={() => onExtend(30)}
          className="px-2 py-0.5 rounded-md bg-secondary/90 text-secondary-foreground text-[10px] font-medium hover:bg-secondary transition-colors"
        >
          +30s
        </button>
      </div>
    </div>
  );
};
