import type { WorkoutTemplate, TemplateExercise, ExerciseId, SetType } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { getExerciseInputMode, usesWeight, isDistanceBased, fromMeters, toMeters } from '@/utils/exerciseInputMode';
import { targetWeightToInput, inputToTargetWeight } from '@/utils/weightConversion';
import { linkedSetType, resolveTemplateSupersets } from '@/utils/templateSupersets';

/**
 * The editing form of a template exercise. Every cell is a string so the user
 * can clear it or type into it freely; the numbers are only read back when the
 * template is saved (`blockToExercise`).
 */
export interface TemplateSetRow {
  setNumber: number;
  targetWeight: string;
  targetReps: string;
  targetRpe: string;
  /** Km as typed, '' for none. The template stores metres; only distance-based work reads it back. */
  targetDistance: string;
}

export interface TemplateBlock {
  exerciseId: ExerciseId;
  /** A snapshot of the library name; readers resolve through the lookup and keep this as the fallback. */
  exerciseName: string;
  sets: TemplateSetRow[];
  setType: SetType;
  restSeconds: number;
  supersetGroup?: number;
}

export type CustomExerciseLite = Parameters<typeof getExerciseInputMode>[1];

function isBandExercise(exerciseId: ExerciseId, customExercises?: CustomExerciseLite): boolean {
  return getExerciseInputMode(exerciseId, customExercises) === 'band';
}

export function exerciseToBlock(
  ex: TemplateExercise,
  lookup?: Record<string, string>,
  weightUnit: WeightUnit = 'kg',
  customExercises?: CustomExerciseLite,
): TemplateBlock {
  const name = lookup?.[ex.exerciseId] ?? EXERCISES[ex.exerciseId]?.name ?? ex.exerciseId;
  const mode = getExerciseInputMode(ex.exerciseId, customExercises);
  const weightInput = targetWeightToInput(ex.targetWeight, weightUnit, isBandExercise(ex.exerciseId, customExercises));
  return {
    exerciseId: ex.exerciseId,
    exerciseName: name,
    setType: ex.setType,
    restSeconds: ex.restSeconds,
    supersetGroup: ex.supersetGroup,
    sets: Array.from({ length: ex.sets }, (_, i) => ({
      setNumber: i + 1,
      targetWeight: weightInput,
      // Blanked only for the modes that render this cell; distance-only work
      // has no input bound to it, so its stored value rides through untouched.
      targetReps: ex.targetReps === 'failure' && mode !== 'distance' ? '' : ex.targetReps.toString(),
      targetRpe: ex.targetRpe?.toString() ?? '',
      targetDistance: ex.targetDistance != null ? String(fromMeters(ex.targetDistance, 'km')) : '',
    })),
  };
}

export function blockToExercise(
  block: TemplateBlock,
  weightUnit: WeightUnit = 'kg',
  customExercises?: CustomExerciseLite,
): TemplateExercise {
  const firstSet = block.sets[0];
  const mode = getExerciseInputMode(block.exerciseId, customExercises);
  // Only the first set's cell decides the saved rep count, so only it can decide
  // "to failure" — a block-level flag written by whichever row was last edited
  // made clearing set 3 of an ordinary template mark the whole exercise to
  // failure. Distance-only work renders no cell at all, so `exerciseToBlock`
  // leaves the literal 'failure' in it and it round-trips here rather than
  // being read as a blank and defaulting to 10.
  const cell = (firstSet?.targetReps ?? '').trim();
  const toFailure = cell === 'failure' || cell === '';
  // parseFloat, then round: the same cell holds minutes for timed work, and
  // parseInt read '0.5' as 0. A zero or negative target is not a target
  // (`|| 10` used to turn 0 into ten); it floors at 1, and only an
  // unreadable cell falls back to the default.
  const typedReps = parseFloat(cell);
  const reps = toFailure ? 'failure' as const : Number.isFinite(typedReps) ? Math.max(1, Math.round(typedReps)) : 10;
  // The picker offers half steps, which parseInt silently rounded down.
  const rpe = parseFloat(firstSet?.targetRpe ?? '');
  // Read back for every distance-based mode, not only the one the editor
  // renders the km box for: every built-in run, row and swim is time-distance,
  // which has no cell, so the string `exerciseToBlock` filled from the stored
  // target rides through untouched and must round-trip. Gating on the
  // distance-only mode alone erased a coach-set target on any save that did
  // not touch the row. Rounded to the metre: 1.005 km is 1005, not
  // 1004.9999999999999.
  const km = parseFloat(firstSet?.targetDistance ?? '');
  const targetDistance = isDistanceBased(mode) && Number.isFinite(km) && km > 0
    ? Math.round(toMeters(km, 'km'))
    : undefined;
  return {
    exerciseId: block.exerciseId,
    sets: block.sets.length,
    targetReps: reps,
    setType: linkedSetType(block.setType, block.supersetGroup !== undefined),
    restSeconds: block.restSeconds,
    // Only weight-based modes put a load in this column — for distance work it
    // holds km, which doesn't belong in targetWeight.
    targetWeight: usesWeight(mode)
      ? inputToTargetWeight(firstSet?.targetWeight, weightUnit, mode === 'band')
      : undefined,
    targetRpe: Number.isFinite(rpe) ? rpe : undefined,
    targetDistance,
    supersetGroup: block.supersetGroup,
  };
}

/** A template's exercises as editable blocks, with its superset links resolved. */
export function templateToBlocks(
  template: WorkoutTemplate,
  weightUnit: WeightUnit = 'kg',
  customExercises?: CustomExerciseLite,
): TemplateBlock[] {
  return resolveTemplateSupersets(template.exercises)
    .map(ex => exerciseToBlock(ex, undefined, weightUnit, customExercises));
}

export function blocksToExercises(
  blocks: TemplateBlock[],
  weightUnit: WeightUnit = 'kg',
  customExercises?: CustomExerciseLite,
): TemplateExercise[] {
  return blocks.map(b => blockToExercise(b, weightUnit, customExercises));
}
