import type { WeightUnit } from '@/hooks/useStorage';

const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 1 / KG_TO_LBS;

/**
 * Convert a weight value from kg to the user's display unit.
 * All weights in the database are stored in kg (canonical).
 * Round-trips (kg→lbs→kg) are lossy at the 0.01-unit level — this is
 * intentional: conversion is display-only; storage is always in kg.
 */
export function fromKg(valueKg: number, unit: WeightUnit): number {
  if (unit === 'kg') return valueKg;
  return Math.round(valueKg * KG_TO_LBS * 100) / 100;
}

/**
 * Convert a weight value from the user's display unit to kg for storage.
 * Only call this when persisting user-entered lbs values; never chain with
 * fromKg on an existing kg value as repeated round-trips accumulate drift.
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

/**
 * Format a workout volume for display.
 *
 * Volume = sum(reps × weight). Weights are stored as kg rounded to 0.01, so
 * once the aggregate sum is converted back to lbs IEEE-754 drift sneaks in —
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
