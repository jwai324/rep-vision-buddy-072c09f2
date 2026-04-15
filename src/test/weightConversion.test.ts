import { describe, it, expect } from 'vitest';
import { fromKg, toKg, formatWeight, formatWeightString } from '@/utils/weightConversion';

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
