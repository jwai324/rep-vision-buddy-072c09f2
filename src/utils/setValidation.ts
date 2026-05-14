import type { WeightUnit } from '@/hooks/useStorage';
import type { ExerciseInputMode } from '@/utils/exerciseInputMode';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

const MAX_WEIGHT_KG = 900;
const WARN_WEIGHT_KG = 450;
const MAX_WEIGHT_LBS = 2000;
const WARN_WEIGHT_LBS = 1000;
const MAX_REPS = 200;
const WARN_REPS = 100;

export function weightRangeMessage(unit: WeightUnit): string {
  const max = unit === 'kg' ? MAX_WEIGHT_KG : MAX_WEIGHT_LBS;
  return `Weight must be 0–${max} ${unit}`;
}

/**
 * Validate a weight value in the user's display unit.
 * @param value - raw input string
 * @param unit - user's weight unit
 * @param isBodyweight - if true, 0 is allowed
 */
export function validateWeight(
  value: string,
  unit: WeightUnit,
  isBodyweight = false,
): ValidationResult {
  if (value === '' || value === undefined) return { valid: false, error: 'Required' };

  const num = parseFloat(value);
  if (isNaN(num)) return { valid: false, error: 'Must be a number' };

  const max = unit === 'kg' ? MAX_WEIGHT_KG : MAX_WEIGHT_LBS;
  const warn = unit === 'kg' ? WARN_WEIGHT_KG : WARN_WEIGHT_LBS;
  const rangeMsg = weightRangeMessage(unit);

  if (num < 0) return { valid: false, error: rangeMsg };
  if (num === 0 && !isBodyweight) return { valid: false, error: 'Weight required' };
  if (num > max) return { valid: false, error: rangeMsg };
  if (num > warn) return { valid: true, warning: `That's very heavy (${num} ${unit})` };

  return { valid: true };
}

/**
 * Validate a reps value.
 */
export function validateReps(value: string): ValidationResult {
  if (value === '' || value === undefined) return { valid: false, error: 'Required' };

  const num = parseInt(value, 10);
  if (isNaN(num) || String(num) !== value.trim()) return { valid: false, error: 'Reps must be 0–200' };
  if (num < 0) return { valid: false, error: 'Reps must be 0–200' };
  if (num > MAX_REPS) return { valid: false, error: 'Reps must be 0–200' };
  if (num > WARN_REPS) return { valid: true, warning: "That's a lot of reps!" };

  return { valid: true };
}

/**
 * Validate RPE value (1-10 in 0.5 increments).
 */
export function validateRpe(value: string): ValidationResult {
  if (value === '' || value === undefined) return { valid: true }; // RPE is optional

  const num = parseFloat(value);
  if (isNaN(num)) return { valid: false, error: 'RPE must be 1–10' };
  if (num < 1 || num > 10) return { valid: false, error: 'RPE must be 1–10' };

  // Check 0.5 increments
  if ((num * 2) % 1 !== 0) return { valid: false, error: 'RPE must use 0.5 increments' };

  return { valid: true };
}

/**
 * Check if a set row has valid weight and reps to allow completion.
 */
export function canCompleteSet(
  weight: string,
  reps: string,
  unit: WeightUnit,
  isBodyweight = false,
  isCardio = false,
  time = '',
  mode?: ExerciseInputMode,
  distance?: string,
): boolean {
  // If mode is provided, use mode-aware logic
  if (mode) {
    switch (mode) {
      case 'time': {
        const timeVal = parseFloat(time);
        return !isNaN(timeVal) && timeVal > 0;
      }
      case 'distance': {
        const distVal = parseFloat(distance ?? '');
        return !isNaN(distVal) && distVal > 0;
      }
      case 'time-distance': {
        const timeVal = parseFloat(time);
        const distVal = parseFloat(distance ?? '');
        // At least one must be filled
        return (!isNaN(timeVal) && timeVal > 0) || (!isNaN(distVal) && distVal > 0);
      }
      case 'reps': {
        const repsResult = validateReps(reps);
        return repsResult.valid;
      }
      case 'band': {
        const repsResult = validateReps(reps);
        return repsResult.valid && weight !== '';
      }
      case 'reps-weight':
      default: {
        const weightResult = validateWeight(weight, unit, isBodyweight);
        const repsResult = validateReps(reps);
        return weightResult.valid && repsResult.valid;
      }
    }
  }

  // Legacy fallback
  if (isCardio) {
    const timeVal = parseFloat(time);
    return !isNaN(timeVal) && timeVal > 0;
  }
  
  const weightResult = validateWeight(weight, unit, isBodyweight);
  const repsResult = validateReps(reps);
  return weightResult.valid && repsResult.valid;
}

export interface SetFieldErrors {
  weight?: string;
  reps?: string;
  rpe?: string;
}

/**
 * Compute display-time errors for a set's fields. Returns an entry only when the
 * field is non-empty AND invalid — empty fields are treated as "not yet filled"
 * (no inline error). The mode controls which fields are checked.
 */
export function getSetFieldErrors(
  fields: { weight?: string; reps?: string; rpe?: string },
  unit: WeightUnit,
  mode: ExerciseInputMode | undefined,
  isBodyweight = false,
): SetFieldErrors {
  const errors: SetFieldErrors = {};

  const weightApplies = mode === undefined || mode === 'reps-weight';
  const repsApplies = mode === undefined || mode === 'reps-weight' || mode === 'reps' || mode === 'band';

  if (weightApplies && fields.weight && fields.weight !== '') {
    const r = validateWeight(fields.weight, unit, isBodyweight);
    if (!r.valid) errors.weight = r.error;
  }
  if (repsApplies && fields.reps && fields.reps !== '') {
    const r = validateReps(fields.reps);
    if (!r.valid) errors.reps = r.error;
  }
  if (fields.rpe && fields.rpe !== '') {
    const r = validateRpe(fields.rpe);
    if (!r.valid) errors.rpe = r.error;
  }
  return errors;
}

export function hasFieldErrors(errors: SetFieldErrors): boolean {
  return !!(errors.weight || errors.reps || errors.rpe);
}

export function isBodyweightExercise(exerciseName: string): boolean {
  return exerciseName.toLowerCase().includes('bodyweight');
}
