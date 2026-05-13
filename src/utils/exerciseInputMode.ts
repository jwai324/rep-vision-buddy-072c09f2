import { EXERCISE_DATABASE, type MeasurementType } from '@/data/exercises';
import type { WeightUnit } from '@/hooks/useStorage';
import { formatMmSs } from '@/utils/timeFormat';

export type ExerciseInputMode = 'reps' | 'reps-weight' | 'time' | 'distance' | 'time-distance' | 'band';

/**
 * Determine the input mode for an exercise based on its measurementType (preferred)
 * or legacy heuristics (fallback).
 *
 * - reps: bodyweight rep work (push-ups, pull-ups)
 * - reps-weight: loaded strength work (bench press, squat)
 * - time: isometric holds + stationary cardio (plank, elliptical)
 * - distance: distance-only (rare; placeholder)
 * - time-distance: locomotive cardio (running, rowing, cycling)
 * - band: band exercises (equipment === 'Band')
 */
export function getExerciseInputMode(
  exerciseId: string,
  customExercises?: { id: string; primaryBodyPart: string; equipment: string; measurementType?: MeasurementType | null }[]
): ExerciseInputMode {
  // Check built-in database first
  let exercise = EXERCISE_DATABASE.find(e => e.id === exerciseId);
  if (!exercise && customExercises) {
    const custom = customExercises.find(e => e.id === exerciseId);
    if (custom) {
      exercise = custom as any;
    }
  }
  if (!exercise) return 'reps-weight';

  // Band equipment always uses band mode
  if (exercise.equipment === 'Band') return 'band';

  // Use measurementType if present
  if (exercise.measurementType) {
    switch (exercise.measurementType) {
      case 'Reps': return 'reps';
      case 'Reps + Weight': return 'reps-weight';
      case 'Time': return 'time';
      case 'Distance': return 'distance';
      case 'Time + Distance': return 'time-distance';
    }
  }

  // Legacy fallback: cardio body part → time (previous 'cardio' mode)
  if (exercise.primaryBodyPart === 'Cardio') {
    console.warn(`Exercise "${exercise.name}" (${exerciseId}) missing measurementType — falling back to time mode`);
    return 'time';
  }

  return 'reps-weight';
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

/** Convert meters to a display string in the given distance unit */
export function formatDistance(meters: number, unit: 'km' | 'mi' | 'm' = 'km'): string {
  switch (unit) {
    case 'km': return `${(meters / 1000).toFixed(2)} km`;
    case 'mi': return `${(meters / 1609.344).toFixed(2)} mi`;
    case 'm': return `${Math.round(meters)} m`;
  }
}

/** Convert a display distance value to meters */
export function toMeters(value: number, unit: 'km' | 'mi' | 'm'): number {
  switch (unit) {
    case 'km': return value * 1000;
    case 'mi': return value * 1609.344;
    case 'm': return value;
  }
}

/** Convert meters to a display value in the given unit */
export function fromMeters(meters: number, unit: 'km' | 'mi' | 'm'): number {
  switch (unit) {
    case 'km': return meters / 1000;
    case 'mi': return meters / 1609.344;
    case 'm': return meters;
  }
}

export type DistanceUnit = 'km' | 'mi' | 'm';

/** Returns the canonical distance unit for a given weight unit (metric → km, imperial → mi). */
export function distanceUnitFromWeightUnit(weightUnit: WeightUnit): DistanceUnit {
  return weightUnit === 'lbs' ? 'mi' : 'km';
}

/**
 * Get the badge label for a measurement type (used in ExerciseSelector).
 */
export function getMeasurementBadge(mode: ExerciseInputMode): { icon: string; label: string } | null {
  switch (mode) {
    case 'time': return { icon: '⏱', label: 'Time' };
    case 'distance': return { icon: '📏', label: 'Distance' };
    case 'time-distance': return { icon: '⏱📏', label: 'Time+Dist' };
    case 'reps': return { icon: '#', label: 'Reps' };
    case 'band': return { icon: '🔗', label: 'Band' };
    case 'reps-weight':
    default: return null; // default, no badge
  }
}

/**
 * Format a set's data for display based on exercise input mode.
 */
export function formatSetDisplay(
  mode: ExerciseInputMode,
  set: { reps: number; weight?: number; time?: number; distance?: number },
  unit: WeightUnit = 'kg'
): string {
  switch (mode) {
    case 'time':
      return formatMmSs(set.time ?? 0);
    case 'distance':
      return formatDistance(set.distance ?? 0);
    case 'time-distance': {
      const timePart = formatMmSs(set.time ?? 0);
      const distPart = set.distance ? formatDistance(set.distance) : '';
      return distPart ? `${timePart} · ${distPart}` : timePart;
    }
    case 'reps':
      return `${set.reps} reps`;
    case 'band':
      return `${getBandLevelShortLabel(set.weight ?? 0)} × ${set.reps}`;
    case 'reps-weight':
    default:
      if (set.weight !== undefined && set.weight !== 0) {
        return `${set.weight} ${unit} × ${set.reps}`;
      }
      return `${set.reps} reps`;
  }
}

/** Whether this mode uses time as the primary metric (no reps/weight needed) */
export function isTimeBased(mode: ExerciseInputMode): boolean {
  return mode === 'time' || mode === 'time-distance';
}

/** Whether this mode uses distance */
export function isDistanceBased(mode: ExerciseInputMode): boolean {
  return mode === 'distance' || mode === 'time-distance';
}

/** Whether this mode requires reps */
export function usesReps(mode: ExerciseInputMode): boolean {
  return mode === 'reps' || mode === 'reps-weight' || mode === 'band';
}

/** Whether this mode requires weight */
export function usesWeight(mode: ExerciseInputMode): boolean {
  return mode === 'reps-weight' || mode === 'band';
}
