import type { WeightUnit } from '@/hooks/useStorage';

const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 1 / KG_TO_LBS;

/**
 * Decimals kept when a stored kg value is rendered back into the user's unit.
 *
 * This is what makes kg → display → kg round-trips stable. Storage keeps the
 * full-precision kg, so 15 lbs is 6.803885 kg, not 6.8 — but even a legacy row
 * that *was* stored rounded to 0.01 kg is off by at most 0.005 kg (0.011 lbs),
 * which one decimal of lbs absorbs. Without it, 15 lbs read back as 14.99.
 *
 * lbs gets one decimal because plates don't go finer than 0.25 lb; kg keeps two
 * so microplate loads (0.25 kg) survive, and because kg is the stored unit a kg
 * user's own entries are already exact at that precision.
 */
const DISPLAY_DECIMALS: Record<WeightUnit, number> = { kg: 2, lbs: 1 };

/** Decimals kept in storage. Enough to be exact for any real load, short
 *  enough that a converted value doesn't serialize as 6.803884999999999. */
const STORAGE_DECIMALS = 6;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Convert a weight value from kg to the user's display unit.
 * All weights in the database are stored in kg (canonical).
 * The result is rounded to `DISPLAY_DECIMALS` so it reads as the number the
 * user typed rather than its conversion residue.
 */
export function fromKg(valueKg: number, unit: WeightUnit): number {
  if (unit === 'kg') return roundTo(valueKg, DISPLAY_DECIMALS.kg);
  return roundTo(valueKg * KG_TO_LBS, DISPLAY_DECIMALS.lbs);
}

/**
 * Convert a weight value from the user's display unit to kg for storage.
 * Only call this when persisting user-entered lbs values; never chain with
 * fromKg on an existing kg value as repeated round-trips accumulate drift.
 */
export function toKg(valueDisplay: number, unit: WeightUnit): number {
  if (unit === 'kg') return valueDisplay;
  return roundTo(valueDisplay * LBS_TO_KG, STORAGE_DECIMALS);
}

/**
 * Read a stored template target load into the string a weight input expects.
 *
 * Band exercises carry a level (1-5) rather than a mass, so they pass straight
 * through; everything else converts kg → the user's display unit. Returns ''
 * when there is no target, which leaves the input blank.
 */
export function targetWeightToInput(
  targetWeight: number | undefined | null,
  unit: WeightUnit,
  isBand: boolean,
): string {
  if (targetWeight == null || isNaN(targetWeight)) return '';
  if (isBand) return String(targetWeight);
  return String(fromKg(targetWeight, unit));
}

/** Inverse of `targetWeightToInput`. Blank or unparseable input means no target. */
export function inputToTargetWeight(
  input: string | undefined | null,
  unit: WeightUnit,
  isBand: boolean,
): number | undefined {
  if (!input) return undefined;
  const parsed = parseFloat(input);
  if (isNaN(parsed)) return undefined;
  return isBand ? parsed : toKg(parsed, unit);
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

/**
 * Format a workout volume for display.
 *
 * Volume = sum(reps × weight). An lbs entry is stored as an inexact kg value,
 * so once the aggregate sum is converted back to lbs IEEE-754 drift sneaks in —
 * 135 lbs × 10 reps can land at 1349.89 or 1350.11 instead of a clean 1350.
 * Round at the display boundary: integer for values ≥ 10, one decimal for
 * smaller values (so very light volumes like 4.5 still read sensibly).
 *
 * The caller passes the value already in `unit`. Use `fromKg(kg, unit)` once
 * before calling — never chain kg → lbs → kg → lbs conversions.
 */
export function formatVolume(
  value: number | undefined | null,
  unit: WeightUnit,
): string {
  if (value == null || isNaN(value)) return `0 ${unit}`;

  const rounded = Math.abs(value) >= 10
    ? Math.round(value)
    : Math.round(value * 10) / 10;

  const raw = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const parts = raw.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${parts.join('.')} ${unit}`;
}

/**
 * Convenience: format a kg-stored volume directly in the user's display unit.
 * Performs a single kg → display conversion, then rounds + formats. Use this
 * at every display site that has `totalVolume` (in kg) in hand.
 */
export function formatVolumeFromKg(
  valueKg: number | undefined | null,
  unit: WeightUnit,
): string {
  if (valueKg == null || isNaN(valueKg)) return `0 ${unit}`;
  const inUnit = unit === 'kg' ? valueKg : valueKg * KG_TO_LBS;
  return formatVolume(inUnit, unit);
}
