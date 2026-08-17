import type { WorkoutProgram, WorkoutSession, WorkoutTemplate } from '@/types/workout';
import type { MeasurementType } from '@/data/exercises';
import type { WeightUnit } from '@/hooks/useStorage';

/**
 * Bumped whenever the snapshot shape changes incompatibly. Snapshots are
 * frozen at share time and live indefinitely, so a link created today has to
 * still be readable by a much later build of the app — the public page checks
 * this before trusting the payload.
 */
export const SHARE_SNAPSHOT_VERSION = 1;

export type ShareKind = 'session' | 'template' | 'program';

/**
 * A custom exercise definition travelling with the snapshot. Custom exercise
 * ids are `custom-<row uuid>` (see useCustomExercises), so the recipient's copy
 * necessarily has a different id — `sourceId` is what the snapshot's
 * `exerciseId` references, and import maps it to a freshly created row.
 */
export interface SharedCustomExercise {
  sourceId: string;
  name: string;
  primaryBodyPart: string;
  equipment: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  exerciseType: 'Compound' | 'Isolation';
  movementPattern: string;
  secondaryMuscles: string[];
  isRecovery: boolean;
  measurementType?: MeasurementType | null;
}

/** Resolved display name for one exercise id, so the public page never needs a lookup hook. */
export interface SharedExerciseMeta {
  exerciseId: string;
  name: string;
  icon: string;
}

interface SnapshotBase {
  version: number;
  sharedAt: string;
  /** The sharer's display unit. Loads inside the snapshot are always canonical kg. */
  weightUnit: WeightUnit;
  sharedBy: string | null;
  customExercises: SharedCustomExercise[];
}

export interface SessionSnapshot extends SnapshotBase {
  kind: 'session';
  session: WorkoutSession;
}

export interface TemplateSnapshot extends SnapshotBase {
  kind: 'template';
  template: WorkoutTemplate;
  exerciseMeta: SharedExerciseMeta[];
}

export interface ProgramSnapshot extends SnapshotBase {
  kind: 'program';
  program: WorkoutProgram;
  /** Every template referenced by a non-rest day, embedded whole. */
  templates: WorkoutTemplate[];
  exerciseMeta: SharedExerciseMeta[];
}

export type ShareSnapshot = SessionSnapshot | TemplateSnapshot | ProgramSnapshot;

/** A row in the owner's "Shared Links" list. Deliberately excludes `payload`. */
export interface ShareListItem {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  sourceId: string | null;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}
