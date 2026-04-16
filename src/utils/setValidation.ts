import type { WeightUnit } from '@/hooks/useStorage';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

const MAX_WEIGHT_KG = 900;
const WARN_WEIGHT_KG = 450;
const MAX_WEIGHT_LBS = 2000;
const WARN_WEIGHT_LBS = 1000;

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
  if (num < 0) return { valid: false, error: 'Weight cannot be negative' };

  const max = unit === 'kg' ? MAX_WEIGHT_KG : MAX_WEIGHT_LBS;
  const warn = unit === 'kg' ? WARN_WEIGHT_KG : WARN_WEIGHT_LBS;

  if (num > max) return { valid: false, error: `Max ${max} ${unit}` };
  if (num > warn) return { valid: true, warning: `That's very heavy (${num} ${unit})` };

  return { valid: true };
}

/**
 * Validate a reps value.
 */
export function validateReps(value: string): ValidationResult {
  if (value === '' || value === undefined) return { valid: false, error: 'Required' };

  const num = parseInt(value, 10);
  if (isNaN(num) || String(num) !== value.trim()) return { valid: false, error: 'Must be a whole number' };
  if (num < 0) return { valid: false, error: 'Reps cannot be negative' };
  if (num > 200) return { valid: false, error: 'Max 200 reps' };
  if (num > 100) return { valid: true, warning: 'That\'s a lot of reps!' };

  return { valid: true };
}

/**
 * Validate RPE value (1-10 in 0.5 increments).
 */
export function validateRpe(value: string): ValidationResult {
  if (value === '' || value === undefined) return { valid: true }; // RPE is optional

  const num = parseFloat(value);
  if (isNaN(num)) return { valid: false, error: 'Must be a number' };
  if (num < 1 || num > 10) return { valid: false, error: 'RPE must be 1-10' };

  // Check 0.5 increments
  if ((num * 2) % 1 !== 0) return { valid: false, error: 'Use 0.5 increments' };

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
): boolean {
  if (isCardio) {
    // Cardio only needs time (stored in reps field)
    const timeVal = parseFloat(reps);
    return !isNaN(timeVal) && timeVal > 0;
  }
  
  const weightResult = validateWeight(weight, unit, isBodyweight);
  const repsResult = validateReps(reps);
  return weightResult.valid && repsResult.valid;
}
