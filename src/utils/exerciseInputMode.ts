import { EXERCISE_DATABASE } from '@/data/exercises';
import type { WeightUnit } from '@/hooks/useStorage';

export type ExerciseInputMode = 'weighted' | 'cardio' | 'band';

/**
 * Determine the input mode for an exercise based on its properties.
 * - cardio: primaryBodyPart === 'Cardio' (includes sports)
 * - band: equipment === 'Band'
 * - weighted: everything else (default)
 */
export function getExerciseInputMode(exerciseId: string, customExercises?: { id: string; primaryBodyPart: string; equipment: string }[]): ExerciseInputMode {
  // Check built-in database first
  let exercise = EXERCISE_DATABASE.find(e => e.id === exerciseId);
  if (!exercise && customExercises) {
    const custom = customExercises.find(e => e.id === exerciseId);
    if (custom) {
      exercise = custom as any;
    }
  }
  if (!exercise) return 'weighted';

  if (exercise.primaryBodyPart === 'Cardio') return 'cardio';
  if (exercise.equipment === 'Band') return 'band';
  return 'weighted';
}

export interface BandLevel {
  level: number;
  label: string;
  weightLb: number;
  weightKg: number;
}

export const BAND_LEVELS: BandLevel[] = [
  { level: 1, label: 'Extra Light', weightLb: 5, weightKg: 2 },
  { level: 2, label: 'Light', weightLb: 15, weightKg: 7 },
  { level: 3, label: 'Medium', weightLb: 25, weightKg: 11 },
  { level: 4, label: 'Heavy', weightLb: 40, weightKg: 18 },
  { level: 5, label: 'Extra Heavy', weightLb: 55, weightKg: 25 },
  { level: 6, label: 'Monster', weightLb: 80, weightKg: 36 },
];

export function getBandLevelLabel(level: number, unit: WeightUnit = 'kg'): string {
  const band = BAND_LEVELS.find(b => b.level === level);
  if (!band) return `Level ${level}`;
  const weight = unit === 'lbs' ? band.weightLb : band.weightKg;
  return `${band.label} (~${weight} ${unit})`;
}

export function getBandLevelShortLabel(level: number): string {
  const band = BAND_LEVELS.find(b => b.level === level);
  return band?.label ?? `Level ${level}`;
}

/**
 * Format a set's data for display based on exercise input mode.
 */
export function formatSetDisplay(
  mode: ExerciseInputMode,
  set: { reps: number; weight?: number; time?: number },
  unit: WeightUnit = 'kg'
): string {
  switch (mode) {
    case 'cardio':
      return set.time ? `${set.time} min` : `${set.reps} min`;
    case 'band':
      return `${getBandLevelShortLabel(set.weight ?? 0)} × ${set.reps}`;
    default:
      if (set.weight !== undefined && set.weight !== 0) {
        return `${set.weight} ${unit} × ${set.reps}`;
      }
      return `${set.reps} reps`;
  }
}
