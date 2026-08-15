import type { TemplateExercise, WorkoutTemplate, ExerciseLog, SetType } from '@/types/workout';

export interface TemplateSnapshotEntry {
  exerciseId: string;
  setCount: number;
  targetReps: number | 'failure';
  setType: SetType;
  supersetGroup?: number;
  /** See TemplateExercise.targetWeight — kg, or a band level for band work. */
  targetWeight?: number;
}

export type TemplateSnapshot = TemplateSnapshotEntry[];

export function snapshotFromTemplateExercises(exs: TemplateExercise[], blocks?: { exerciseId: string; supersetGroup?: number }[]): TemplateSnapshot {
  return exs.map((e, i) => ({
    exerciseId: e.exerciseId,
    setCount: e.sets,
    targetReps: e.targetReps,
    setType: e.setType,
    supersetGroup: blocks?.[i]?.supersetGroup ?? e.supersetGroup,
    targetWeight: e.targetWeight,
  }));
}

export interface FinishedBlockLite {
  exerciseId: string;
  completedSetCount: number;
  lastReps: number | null;
  /** Load on the last completed working set, in the same units as targetWeight. */
  lastWeight?: number | null;
  setType: SetType;
  supersetGroup?: number;
  restSeconds: number;
}

export function snapshotFromFinishedBlocks(blocks: FinishedBlockLite[]): TemplateSnapshot {
  return blocks.map(b => ({
    exerciseId: b.exerciseId,
    setCount: b.completedSetCount,
    targetReps: b.lastReps && b.lastReps > 0 ? b.lastReps : 'failure',
    setType: b.setType,
    supersetGroup: b.supersetGroup,
    targetWeight: b.lastWeight ?? undefined,
  }));
}

/**
 * Loads are stored to 0.01 kg, and an lbs entry round-trips through kg, so a
 * bare !== would flag an unchanged weight as an edit. Anything under 10g apart
 * is the same load.
 */
function sameWeight(a: number | undefined, b: number | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.01;
}

export interface TemplateDiff {
  hasChanges: boolean;
  added: number;
  removed: number;
  swapped: number;
  setCountChanged: number;
  targetRepsChanged: number;
  targetWeightChanged: number;
  supersetChanged: number;
  summary: string;
}

export function diffTemplateSnapshots(before: TemplateSnapshot, after: TemplateSnapshot): TemplateDiff {
  let added = 0, removed = 0, swapped = 0, setCountChanged = 0, targetRepsChanged = 0, targetWeightChanged = 0, supersetChanged = 0;

  const beforeIds = new Set(before.map(b => b.exerciseId));
  const afterIds = new Set(after.map(a => a.exerciseId));

  for (const id of afterIds) if (!beforeIds.has(id)) added++;
  for (const id of beforeIds) if (!afterIds.has(id)) removed++;

  // Position-based swap detection within shared length
  const minLen = Math.min(before.length, after.length);
  for (let i = 0; i < minLen; i++) {
    if (before[i].exerciseId !== after[i].exerciseId && beforeIds.has(after[i].exerciseId) && afterIds.has(before[i].exerciseId)) {
      swapped++;
    }
  }

  // Per-exercise comparisons (match by exerciseId)
  const beforeMap = new Map(before.map(b => [b.exerciseId, b]));
  for (const a of after) {
    const b = beforeMap.get(a.exerciseId);
    if (!b) continue;
    if (b.setCount !== a.setCount) setCountChanged++;
    if (String(b.targetReps) !== String(a.targetReps)) targetRepsChanged++;
    // A finished exercise with no load logged (bodyweight work, or a set left
    // blank) says nothing about the target, so it never counts as a change.
    if (a.targetWeight != null && !sameWeight(b.targetWeight, a.targetWeight)) targetWeightChanged++;
    if ((b.supersetGroup ?? null) !== (a.supersetGroup ?? null)) supersetChanged++;
  }

  const parts: string[] = [];
  if (added) parts.push(`+${added} exercise${added > 1 ? 's' : ''}`);
  if (removed) parts.push(`-${removed} exercise${removed > 1 ? 's' : ''}`);
  if (swapped) parts.push(`${swapped} swap${swapped > 1 ? 's' : ''}`);
  if (setCountChanged) parts.push(`${setCountChanged} set count change${setCountChanged > 1 ? 's' : ''}`);
  if (targetRepsChanged) parts.push(`${targetRepsChanged} rep target change${targetRepsChanged > 1 ? 's' : ''}`);
  if (targetWeightChanged) parts.push(`${targetWeightChanged} weight change${targetWeightChanged > 1 ? 's' : ''}`);
  if (supersetChanged) parts.push(`${supersetChanged} superset change${supersetChanged > 1 ? 's' : ''}`);

  const hasChanges = added + removed + swapped + setCountChanged + targetRepsChanged + targetWeightChanged + supersetChanged > 0;

  return {
    hasChanges,
    added, removed, swapped, setCountChanged, targetRepsChanged, targetWeightChanged, supersetChanged,
    summary: parts.join(', '),
  };
}

/** Build an updated WorkoutTemplate from finished blocks, preserving existing restSeconds where possible. */
export function buildUpdatedTemplate(template: WorkoutTemplate, finished: FinishedBlockLite[]): WorkoutTemplate {
  const byId = new Map(template.exercises.map(e => [e.exerciseId, e] as const));
  return {
    ...template,
    exercises: finished.map(b => {
      const existing = byId.get(b.exerciseId);
      return {
        exerciseId: b.exerciseId,
        sets: Math.max(1, b.completedSetCount),
        targetReps: b.lastReps && b.lastReps > 0 ? b.lastReps : 'failure',
        setType: b.setType,
        restSeconds: existing?.restSeconds ?? b.restSeconds ?? 90,
        // Keep the existing target when nothing was logged, so bodyweight work
        // and skipped weight fields don't wipe a target the user set by hand.
        targetWeight: b.lastWeight ?? existing?.targetWeight,
        targetRpe: existing?.targetRpe,
        supersetGroup: b.supersetGroup,
      };
    }),
  };
}
