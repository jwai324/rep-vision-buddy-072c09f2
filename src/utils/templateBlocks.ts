import type { WorkoutTemplate, TemplateExercise, ExerciseId, SetType } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { getExerciseInputMode, usesWeight } from '@/utils/exerciseInputMode';
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
  const reps = toFailure ? 'failure' as const : (parseInt(cell) || 10);
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
    targetRpe: firstSet?.targetRpe ? parseInt(firstSet.targetRpe) : undefined,
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
