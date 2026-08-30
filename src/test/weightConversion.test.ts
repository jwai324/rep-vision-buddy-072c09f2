import { describe, it, expect } from 'vitest';
import { fromKg, toKg, formatWeight, formatWeightString, formatVolume, formatVolumeFromKg, targetWeightToInput, inputToTargetWeight } from '@/utils/weightConversion';

describe('template target weight round-trip', () => {
  it('shows a kg target unchanged in kg', () => {
    expect(targetWeightToInput(60, 'kg', false)).toBe('60');
  });

  it('shows a kg target converted for an lbs user', () => {
    expect(parseFloat(targetWeightToInput(61.23, 'lbs', false))).toBeCloseTo(135, 0);
  });

  it('stores an lbs entry back as kg', () => {
    expect(inputToTargetWeight('135', 'lbs', false)).toBeCloseTo(61.23, 1);
  });

  it('survives a display → storage round-trip in lbs', () => {
    const shown = targetWeightToInput(61.23, 'lbs', false);
    expect(inputToTargetWeight(shown, 'lbs', false)).toBeCloseTo(61.23, 1);
  });

  it('passes band levels through untouched in both directions', () => {
    expect(targetWeightToInput(3, 'lbs', true)).toBe('3');
    expect(inputToTargetWeight('3', 'lbs', true)).toBe(3);
  });

  it('treats a missing or blank target as no target', () => {
    expect(targetWeightToInput(undefined, 'kg', false)).toBe('');
    expect(inputToTargetWeight('', 'kg', false)).toBeUndefined();
    expect(inputToTargetWeight('abc', 'kg', false)).toBeUndefined();
  });
});

describe('fromKg', () => {
  it('returns same value for kg', () => {
    expect(fromKg(100, 'kg')).toBe(100);
  });

  it('converts kg to lbs', () => {
    expect(fromKg(100, 'lbs')).toBeCloseTo(220.46, 1);
  });

  it('handles 0', () => {
    expect(fromKg(0, 'lbs')).toBe(0);
  });
});

describe('round-trip stability (the "14.99" bug)', () => {
  const LBS_ENTRIES = [15, 2.5, 27.5, 35, 45, 95, 135, 137.5, 185, 225, 315, 405];

  it.each(LBS_ENTRIES)('an entry of %s lbs reads back as the same number', (entered) => {
    expect(fromKg(toKg(entered, 'lbs'), 'lbs')).toBe(entered);
  });

  it.each(LBS_ENTRIES)('%s lbs survives repeated save/load cycles', (entered) => {
    let kg = toKg(entered, 'lbs');
    for (let i = 0; i < 20; i++) {
      kg = toKg(fromKg(kg, 'lbs'), 'lbs');
    }
    expect(fromKg(kg, 'lbs')).toBe(entered);
  });

  it('heals legacy rows that were stored rounded to 0.01 kg', () => {
    // 15 lbs used to be persisted as 6.8 kg, which read back as 14.99.
    expect(fromKg(6.8, 'lbs')).toBe(15);
    expect(fromKg(61.23, 'lbs')).toBe(135);
    expect(fromKg(102.06, 'lbs')).toBe(225);
  });

  it('renders into an input without conversion residue', () => {
    const stored = inputToTargetWeight('15', 'lbs', false)!;
    expect(targetWeightToInput(stored, 'lbs', false)).toBe('15');
  });

  it('keeps kg entries exact', () => {
    expect(fromKg(toKg(60, 'kg'), 'kg')).toBe(60);
    expect(fromKg(toKg(62.5, 'kg'), 'kg')).toBe(62.5);
  });

  it('shows an lbs-entered load to a kg user without a decimal tail', () => {
    expect(fromKg(toKg(15, 'lbs'), 'kg')).toBe(6.8);
    expect(fromKg(toKg(135, 'lbs'), 'kg')).toBe(61.24);
  });
});

describe('toKg', () => {
  it('returns same value for kg', () => {
    expect(toKg(100, 'kg')).toBe(100);
  });

  it('converts lbs to kg', () => {
    expect(toKg(220, 'lbs')).toBeCloseTo(99.79, 1);
  });

  it('roundtrip is close', () => {
    const original = 60;
    const lbs = fromKg(original, 'lbs');
    const backToKg = toKg(lbs, 'lbs');
    expect(backToKg).toBeCloseTo(original, 0);
  });
});

describe('formatWeight', () => {
  it('formats kg', () => {
    const result = formatWeight(60, 'kg');
    expect(result.display).toBe('60');
    expect(result.unitLabel).toBe('kg');
  });

  it('formats lbs', () => {
    const result = formatWeight(60, 'lbs');
    expect(parseFloat(result.display)).toBeCloseTo(132.3, 0);
    expect(result.unitLabel).toBe('lbs');
  });

  it('handles null', () => {
    expect(formatWeight(null, 'kg').display).toBe('0');
  });

  it('handles undefined', () => {
    expect(formatWeight(undefined, 'lbs').display).toBe('0');
  });
});

describe('formatWeightString', () => {
  it('returns "60 kg"', () => {
    expect(formatWeightString(60, 'kg')).toBe('60 kg');
  });

  it('returns lbs string', () => {
    const result = formatWeightString(60, 'lbs');
    expect(result).toMatch(/\d+ lbs/);
  });
});

describe('formatVolume', () => {
  it('rounds .0999 drift down to integer', () => {
    expect(formatVolume(1350.0999, 'lbs')).toBe('1,350 lbs');
  });

  it('rounds .0001 drift down to integer', () => {
    expect(formatVolume(600.0001, 'kg')).toBe('600 kg');
  });

  it('rounds .89 up to next integer', () => {
    expect(formatVolume(1349.89, 'lbs')).toBe('1,350 lbs');
  });

  it('rounds .11 down to integer', () => {
    expect(formatVolume(1350.11, 'lbs')).toBe('1,350 lbs');
  });

  it('formats clean integer with unit', () => {
    expect(formatVolume(1350, 'lbs')).toBe('1,350 lbs');
    expect(formatVolume(600, 'kg')).toBe('600 kg');
  });

  it('uses one decimal for small values', () => {
    expect(formatVolume(4.5, 'kg')).toBe('4.5 kg');
    expect(formatVolume(4.55, 'kg')).toBe('4.6 kg');
    expect(formatVolume(4.0001, 'kg')).toBe('4 kg');
  });

  it('rounds integer for values >= 10', () => {
    expect(formatVolume(10.4, 'kg')).toBe('10 kg');
    expect(formatVolume(10.5, 'kg')).toBe('11 kg');
  });

  it('adds thousands separators', () => {
    expect(formatVolume(12345.6, 'lbs')).toBe('12,346 lbs');
    expect(formatVolume(1000000, 'kg')).toBe('1,000,000 kg');
  });

  it('handles 0', () => {
    expect(formatVolume(0, 'lbs')).toBe('0 lbs');
    expect(formatVolume(0, 'kg')).toBe('0 kg');
  });

  it('handles null/undefined/NaN', () => {
    expect(formatVolume(null, 'lbs')).toBe('0 lbs');
    expect(formatVolume(undefined, 'kg')).toBe('0 kg');
    expect(formatVolume(NaN, 'lbs')).toBe('0 lbs');
  });

  it('round-trip: 135 lbs → kg → back to lbs → × 10 reps still displays "1,350 lbs"', () => {
    const lbs = 135;
    const kg = toKg(lbs, 'lbs');
    const backLbs = fromKg(kg, 'lbs');
    const volumeLbs = backLbs * 10;
    expect(formatVolume(volumeLbs, 'lbs')).toBe('1,350 lbs');
  });

  it('round-trip: 60 kg × 10 reps displays "600 kg"', () => {
    expect(formatVolume(60 * 10, 'kg')).toBe('600 kg');
  });
});

describe('formatVolumeFromKg', () => {
  it('returns "600 kg" for 60 kg × 10 reps stored in kg', () => {
    expect(formatVolumeFromKg(60 * 10, 'kg')).toBe('600 kg');
  });

  it('converts kg-stored volume from 135 lbs × 10 reps to "1,350 lbs"', () => {
    const oneRepKg = toKg(135, 'lbs');
    const totalVolumeKg = oneRepKg * 10;
    expect(formatVolumeFromKg(totalVolumeKg, 'lbs')).toBe('1,350 lbs');
  });

  it('handles null', () => {
    expect(formatVolumeFromKg(null, 'lbs')).toBe('0 lbs');
    expect(formatVolumeFromKg(undefined, 'kg')).toBe('0 kg');
  });

  it('passes through kg directly', () => {
    expect(formatVolumeFromKg(600.0001, 'kg')).toBe('600 kg');
  });
});
