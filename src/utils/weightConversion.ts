import type { WeightUnit } from '@/hooks/useStorage';

const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 1 / KG_TO_LBS;

/**
 * Convert a weight value from kg to the user's display unit.
 * All weights in the database are stored in kg (canonical).
 */
export function fromKg(valueKg: number, unit: WeightUnit): number {
  if (unit === 'kg') return valueKg;
  return Math.round(valueKg * KG_TO_LBS * 100) / 100;
}

/**
 * Convert a weight value from the user's display unit to kg for storage.
 */
export function toKg(valueDisplay: number, unit: WeightUnit): number {
  if (unit === 'kg') return valueDisplay;
  return Math.round(valueDisplay * LBS_TO_KG * 100) / 100;
}

/**
 * Format a weight (stored in kg) for display in the user's preferred unit.
 * Returns the formatted value and unit label.
 */
export function formatWeight(
  valueKg: number | undefined | null,
  unit: WeightUnit,
): { value: number; display: string; unitLabel: string } {
  if (valueKg == null || isNaN(valueKg)) {
    return { value: 0, display: '0', unitLabel: unit };
  }
  const converted = fromKg(valueKg, unit);
  // Remove unnecessary decimals
  const raw = Number.isInteger(converted)
    ? String(converted)
    : converted.toFixed(1).replace(/\.0$/, '');
  // Add thousands separators (e.g. 1,234)
  const parts = raw.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const display = parts.join('.');
  return { value: converted, display, unitLabel: unit };
}

/**
 * Format a weight for display as a compact string like "135 lbs" or "60 kg".
 */
export function formatWeightString(
  valueKg: number | undefined | null,
  unit: WeightUnit,
): string {
  const { display, unitLabel } = formatWeight(valueKg, unit);
  return `${display} ${unitLabel}`;
}
