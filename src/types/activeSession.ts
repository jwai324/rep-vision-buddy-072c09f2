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
 * The tint a linked exercise's card carries. One helper for every surface —
 * the template builder, the live session, the summary — so a superset looks
 * the same wherever it is shown.
 */
export function supersetColorClass(group?: number): string {
  if (group === undefined) return '';
  return SUPERSET_COLORS[(group - 1) % SUPERSET_COLORS.length];
}

/** The solid mark for a group, paired with `supersetColorClass`. */
export function supersetDotClass(group?: number): string {
  if (group === undefined) return '';
  return SUPERSET_DOT_COLORS[(group - 1) % SUPERSET_DOT_COLORS.length];
}

/**
 * What a group is called on screen. Group ids are allocation order and mean
 * nothing to the user, so they are shown as A, B, C… — the way a program
 * writes A1/A2, B1/B2.
 */
export function supersetLabel(group: number): string {
  const idx = group - 1;
  const letter = String.fromCharCode(65 + (idx % 26));
  const cycle = Math.floor(idx / 26);
  return cycle === 0 ? letter : `${letter}${cycle + 1}`;
}
