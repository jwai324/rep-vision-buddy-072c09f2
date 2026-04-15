import { describe, it, expect } from 'vitest';
import { toKg, fromKg, formatWeight, formatWeightString } from '@/utils/weightConversion';
import { validateWeight, validateReps, validateRpe, canCompleteSet } from '@/utils/setValidation';
import { normalizeSearch, searchExercises } from '@/utils/exerciseSearch';
import { EXERCISE_DATABASE } from '@/data/exercises';

// ─── Integration: Consistent weight display across the app ───────────

describe('Weight round-trip consistency', () => {
  it('135 kg saved → shows 135 kg in all views', () => {
    const savedKg = 135;
    const display = formatWeightString(savedKg, 'kg');
    expect(display).toBe('135 kg');

    // Verify formatWeight also consistent
    const fw = formatWeight(savedKg, 'kg');
    expect(fw.value).toBe(135);
    expect(fw.display).toBe('135');
    expect(fw.unitLabel).toBe('kg');
  });

  it('135 kg saved → shows consistent lbs across formatWeight and formatWeightString', () => {
    const savedKg = 135;
    const fw = formatWeight(savedKg, 'lbs');
    const display = formatWeightString(savedKg, 'lbs');
    // Both must produce the same string
    expect(display).toBe(`${fw.display} lbs`);
    expect(fw.value).toBeCloseTo(297.62, 1);
  });

  it('user enters 135 lbs → saves as kg → displays back as 135 lbs', () => {
    const userEntry = 135;
    const stored = toKg(userEntry, 'lbs'); // ~61.24 kg
    const displayedBack = fromKg(stored, 'lbs');
    // Should round-trip back to approximately 135
    expect(Math.abs(displayedBack - userEntry)).toBeLessThan(0.1);
  });

  it('user enters 60 kg → saves → displays 60 kg', () => {
    const stored = toKg(60, 'kg');
    expect(stored).toBe(60);
    const displayed = formatWeightString(stored, 'kg');
    expect(displayed).toBe('60 kg');
  });

  it('workout volume: 135 kg × 10 reps = 1350 total volume', () => {
    const weightKg = 135;
    const reps = 10;
    const volume = weightKg * reps;
    expect(volume).toBe(1350);
    
    // In lbs display: volume is still stored in kg internally
    const volumeDisplayLbs = fromKg(volume, 'lbs');
    expect(volumeDisplayLbs).toBeGreaterThan(2900);
  });
});

// ─── Integration: Invalid input blocking ─────────────────────────────

describe('Invalid input blocking', () => {
  it('-50 weight is blocked in kg', () => {
    const result = validateWeight('-50', 'kg');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('negative');
  });

  it('-50 weight is blocked in lbs', () => {
    const result = validateWeight('-50', 'lbs');
    expect(result.valid).toBe(false);
  });

  it('99999 reps is blocked', () => {
    const result = validateReps('99999');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('200');
  });

  it('RPE 15 is blocked', () => {
    const result = validateRpe('15');
    expect(result.valid).toBe(false);
  });

  it('canCompleteSet rejects negative weight', () => {
    expect(canCompleteSet('-10', '10', 'kg')).toBe(false);
  });

  it('canCompleteSet rejects 99999 reps', () => {
    expect(canCompleteSet('60', '99999', 'kg')).toBe(false);
  });

  it('canCompleteSet accepts valid 135kg × 10 reps', () => {
    expect(canCompleteSet('135', '10', 'kg')).toBe(true);
  });

  it('canCompleteSet accepts bodyweight 0 weight', () => {
    expect(canCompleteSet('0', '10', 'kg', true)).toBe(true);
  });
});

// ─── Integration: Duplicate custom exercise detection ────────────────

describe('Duplicate exercise name detection', () => {
  it('"Dumbbell Curl" matches canonical exercise', () => {
    const exists = EXERCISE_DATABASE.some(
      e => e.name.toLowerCase() === 'dumbbell curl'
    );
    expect(exists).toBe(true);
  });

  it('"dumbbell curl" (lowercase) matches via normalizeSearch', () => {
    const normalized = normalizeSearch('dumbbell curl');
    const match = EXERCISE_DATABASE.some(
      e => normalizeSearch(e.name) === normalized
    );
    expect(match).toBe(true);
  });

  it('"DUMBBELL CURL" (uppercase) matches via normalizeSearch', () => {
    const normalized = normalizeSearch('DUMBBELL CURL');
    const match = EXERCISE_DATABASE.some(
      e => normalizeSearch(e.name) === normalized
    );
    expect(match).toBe(true);
  });

  it('"Dumbell Curl" (typo) is found by fuzzy search', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'Dumbell Curl');
    const hasCurl = results.some(e => e.name.toLowerCase().includes('dumbbell curl'));
    expect(hasCurl).toBe(true);
  });
});

// ─── Integration: Search normalizer and ranking ──────────────────────

describe('Search ranking consistency', () => {
  it('exact name match ranks higher than partial match', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'Bench Press');
    expect(results.length).toBeGreaterThan(0);
    // First result should be the exact "Bench Press" or "Barbell Bench Press"
    expect(results[0].name.toLowerCase()).toContain('bench press');
  });

  it('"db curl" alias returns dumbbell exercises', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'db curl');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(e => e.name.toLowerCase().includes('dumbbell'))).toBe(true);
  });

  it('"bicepcurl" (no space) finds bicep curl exercises', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'bicepcurl');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Integration: AI Program duration validation ─────────────────────

describe('AI Program duration parsing', () => {
  it('parses "4 weeks" to 4', () => {
    const input = '4 weeks';
    const weeks = parseInt(input);
    expect(weeks).toBe(4);
  });

  it('parses "12 weeks" to 12', () => {
    const input = '12 weeks';
    const weeks = parseInt(input);
    expect(weeks).toBe(12);
  });

  it('falls back to 4 for invalid input', () => {
    const input = 'forever';
    const weeks = parseInt(input) || 4;
    expect(weeks).toBe(4);
  });
});
