import type { ExerciseId, SetType } from '@/types/workout';
import type { TimerId } from '@/components/ExerciseRestTimer';
import type { WeightUnit } from '@/hooks/useStorage';
import type { TemplateSnapshot } from '@/utils/templateDiff';

export type TimerStatus = 'running' | 'paused' | 'completed';

export interface PersistedTimer {
  id: TimerId;
  startedAtEpoch: number;
  duration: number;
  originalDuration: number;
  status: TimerStatus;
  elapsedAtPause?: number;
}

export interface DropRow {
  weight: string;
  reps: string;
  rpe: string;
  completed: boolean;
  time?: string;
  distance?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface SetRow {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  type: SetType;
  rpe: string;
  time: string;
  distance?: string;
  startedAt?: number;
  endedAt?: number;
  drops?: DropRow[];
}

export interface RunningSetState {
  blockIdx: number;
  setIdx: number;
  dropIdx?: number;
  startedAt: number;
}

export interface ExerciseBlock {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: SetRow[];
  note?: string;
  supersetGroup?: number;
  restSeconds: number;
  dropSetsEnabled?: boolean;
}

export interface ActiveSessionCache {
  blocks: ExerciseBlock[];
  workoutName: string;
  startTimestamp: number;
  elapsedAtCache: number;
  location?: string;
  workoutNote?: string;
  activeTimer?: PersistedTimer | null;
  restRecords?: Record<string, number>;
  runningSet?: RunningSetState | null;
  showFocusMode?: boolean;
  showExercisePicker?: boolean;
  pendingExerciseIds?: ExerciseId[];
  // Workout-timer pause state so the MinimizedSessionBar can freeze its
  // elapsed display instead of ticking against a stale startTimestamp when
  // the user paused the session and then minimized.
  timerPaused?: boolean;
  pausedElapsedSec?: number | null;
  // Snapshot of the source template captured at session start. Persisted so
  // the "Update template?" prompt can still fire after a minimize/resume or
  // cold reload — without it the ref inside ActiveSession would be null on
  // re-mount and the diff check would silently skip.
  templateSnapshot?: TemplateSnapshot | null;
  // Which template the session was started from. Needed for the same reason as
  // the snapshot: a cold reload rebuilds the screen from this cache alone, and
  // without the id there is no template to offer to update.
  templateId?: string | null;
}

export const SUPERSET_COLORS = [
  'bg-red-500/20',
  'bg-blue-500/20',
  'bg-green-500/20',
  'bg-yellow-500/20',
  'bg-pink-500/20',
  'bg-orange-500/20',
  'bg-amber-800/20',
  'bg-purple-500/20',
  'bg-white/20',
];

// The same hues at full strength. A card is already washed in its group's
// tint, so the badge that names the group needs a mark that still reads on
// top of it. Kept next to SUPERSET_COLORS, and in the same order, because the
// two are only ever right together.
export const SUPERSET_DOT_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-amber-800',
  'bg-purple-500',
  'bg-white',
];

/**
 * The tint a linked exercise's card carries, keyed by the group's ORDINAL —
 * first group on screen, second, and so on — not by its stored id. Ids are
 * allocation order and go sparse as supersets are made and unmade, so keying
 * colour on them makes the second pair in a template green. Callers get the
 * ordinal from `supersetInfo`.
 */
export function supersetColorClass(ordinal?: number): string {
  if (ordinal === undefined) return '';
  return SUPERSET_COLORS[(ordinal - 1) % SUPERSET_COLORS.length];
}

/** The solid mark for a group, paired with `supersetColorClass`. */
export function supersetDotClass(ordinal?: number): string {
  if (ordinal === undefined) return '';
  return SUPERSET_DOT_COLORS[(ordinal - 1) % SUPERSET_DOT_COLORS.length];
}

/** What a group is called on screen: A, B, C… the way a program writes A1/A2. */
export function supersetLetter(ordinal: number): string {
  const i = ordinal - 1;
  const letter = String.fromCharCode(65 + (i % 26));
  const cycle = Math.floor(i / 26);
  return cycle === 0 ? letter : `${letter}${cycle + 1}`;
}

export interface SupersetInfo {
  /** The stored group id. Internal — never shown. */
  group: number;
  /** 1-based position of the group among the groups present. */
  ordinal: number;
  /** A, B, C… */
  letter: string;
  /** Where this exercise falls inside its group, 1-based. */
  position: number;
  /** How many exercises the group links. */
  size: number;
  colorClass: string;
  dotClass: string;
}

/**
 * Everything a surface needs to show one exercise's superset: which pairing it
 * is, where it sits in it, and how big it is. One helper for the live session,
 * the focus screen, the template builder, the linker and the summary, so a
 * superset reads the same everywhere.
 *
 * Returns null for an exercise that is not linked.
 */
export function supersetInfo(
  items: readonly { supersetGroup?: number }[],
  idx: number,
): SupersetInfo | null {
  const group = items[idx]?.supersetGroup;
  if (group === undefined) return null;

  const order: number[] = [];
  const members: number[] = [];
  items.forEach((item, i) => {
    if (item.supersetGroup === undefined) return;
    if (!order.includes(item.supersetGroup)) order.push(item.supersetGroup);
    if (item.supersetGroup === group) members.push(i);
  });

  const ordinal = order.indexOf(group) + 1;
  return {
    group,
    ordinal,
    letter: supersetLetter(ordinal),
    position: members.indexOf(idx) + 1,
    size: members.length,
    colorClass: supersetColorClass(ordinal),
    dotClass: supersetDotClass(ordinal),
  };
}
