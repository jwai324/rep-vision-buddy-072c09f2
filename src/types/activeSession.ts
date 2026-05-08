import type { ExerciseId, SetType } from '@/types/workout';
import type { TimerId } from '@/components/ExerciseRestTimer';
import type { WeightUnit } from '@/hooks/useStorage';

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
