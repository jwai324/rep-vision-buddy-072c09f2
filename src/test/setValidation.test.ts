import { describe, it, expect } from 'vitest';
import { validateWeight, validateReps, validateRpe, canCompleteSet, getSetFieldErrors, hasFieldErrors, isBodyweightExercise } from '@/utils/setValidation';

describe('validateWeight', () => {
  it('rejects empty', () => {
    expect(validateWeight('', 'kg').valid).toBe(false);
  });

  it('rejects negative with 0–max range message', () => {
    expect(validateWeight('-50', 'kg').valid).toBe(false);
    expect(validateWeight('-50', 'kg').error).toMatch(/0.*900.*kg/);
  });

  it('rejects 0 for non-bodyweight', () => {
    expect(validateWeight('0', 'kg', false).valid).toBe(false);
  });

  it('allows 0 for bodyweight', () => {
    expect(validateWeight('0', 'kg', true).valid).toBe(true);
  });

  it('rejects over max kg', () => {
    expect(validateWeight('901', 'kg').valid).toBe(false);
  });

  it('rejects over max lbs', () => {
    expect(validateWeight('2001', 'lbs').valid).toBe(false);
  });

  it('warns on high weight kg', () => {
    const result = validateWeight('500', 'kg');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('warns on high weight lbs', () => {
    const result = validateWeight('1100', 'lbs');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('accepts valid weight', () => {
    expect(validateWeight('100', 'kg').valid).toBe(true);
    expect(validateWeight('100', 'kg').error).toBeUndefined();
  });

  it('rejects NaN', () => {
    expect(validateWeight('abc', 'kg').valid).toBe(false);
  });

  // ── Boundary tests (lbs unit) ──
  it.each([
    ['-201', false],
    ['-200', false],
    ['200',  true ],
    ['201',  true ],
    ['2000', true ],
    ['2001', false],
  ])('boundary lbs %s → valid=%s', (value, expected) => {
    expect(validateWeight(value, 'lbs').valid).toBe(expected);
  });

  it('lbs boundary error message names range', () => {
    expect(validateWeight('2001', 'lbs').error).toMatch(/0.*2000.*lbs/);
    expect(validateWeight('-201', 'lbs').error).toMatch(/0.*2000.*lbs/);
  });

  it('rejects -300 (acceptance criterion)', () => {
    expect(validateWeight('-300', 'lbs').valid).toBe(false);
    expect(validateWeight('-300', 'kg').valid).toBe(false);
  });
});

describe('validateReps', () => {
  it('rejects empty', () => {
    expect(validateReps('').valid).toBe(false);
  });

  it('rejects negative', () => {
    expect(validateReps('-1').valid).toBe(false);
  });

  it('rejects over 200', () => {
    expect(validateReps('201').valid).toBe(false);
  });

  it('rejects 99999', () => {
    expect(validateReps('99999').valid).toBe(false);
  });

  it('warns over 100', () => {
    const result = validateReps('150');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('accepts valid reps', () => {
    expect(validateReps('10').valid).toBe(true);
  });

  it('rejects decimals (non-integer)', () => {
    expect(validateReps('10.5').valid).toBe(false);
    expect(validateReps('10.5').error).toMatch(/0.*200/);
  });

  // ── Boundary tests ──
  it.each([
    ['-1',  false],
    ['0',   true ],
    ['200', true ],
    ['201', false],
  ])('boundary reps %s → valid=%s', (value, expected) => {
    expect(validateReps(value).valid).toBe(expected);
  });

  it('error message names 0–200 range', () => {
    expect(validateReps('-5').error).toMatch(/0.*200/);
    expect(validateReps('500').error).toMatch(/0.*200/);
  });
});

describe('validateRpe', () => {
  it('allows empty (optional)', () => {
    expect(validateRpe('').valid).toBe(true);
  });

  it('rejects below 1', () => {
    expect(validateRpe('0').valid).toBe(false);
  });

  it('rejects above 10', () => {
    expect(validateRpe('11').valid).toBe(false);
  });

  it('accepts 0.5 increments', () => {
    expect(validateRpe('7.5').valid).toBe(true);
    expect(validateRpe('8').valid).toBe(true);
  });

  it('rejects non-0.5 increments', () => {
    expect(validateRpe('7.3').valid).toBe(false);
    expect(validateRpe('7.3').error).toMatch(/0\.5/);
  });

  // ── Boundary tests ──
  it.each([
    ['0.5',  false],
    ['1',    true ],
    ['10',   true ],
    ['10.5', false],
    ['11',   false],
  ])('boundary RPE %s → valid=%s', (value, expected) => {
    expect(validateRpe(value).valid).toBe(expected);
  });

  it('out-of-range error names 1-10 range', () => {
    expect(validateRpe('11').error).toMatch(/1.*10/);
    expect(validateRpe('0.5').error).toMatch(/1.*10/);
  });
});

describe('getSetFieldErrors', () => {
  it('returns no errors when all fields empty', () => {
    expect(getSetFieldErrors({ weight: '', reps: '', rpe: '' }, 'lbs', 'reps-weight')).toEqual({});
  });

  it('returns weight error for -250 lbs', () => {
    const errs = getSetFieldErrors({ weight: '-250', reps: '10', rpe: '' }, 'lbs', 'reps-weight');
    expect(errs.weight).toMatch(/0.*2000.*lbs/);
    expect(errs.reps).toBeUndefined();
  });

  it('returns reps error for 99999 reps', () => {
    const errs = getSetFieldErrors({ weight: '100', reps: '99999', rpe: '' }, 'lbs', 'reps-weight');
    expect(errs.reps).toMatch(/0.*200/);
    expect(errs.weight).toBeUndefined();
  });

  it('returns rpe error for 11', () => {
    const errs = getSetFieldErrors({ weight: '100', reps: '10', rpe: '11' }, 'lbs', 'reps-weight');
    expect(errs.rpe).toMatch(/1.*10/);
  });

  it('reports nothing for valid set', () => {
    const errs = getSetFieldErrors({ weight: '135', reps: '10', rpe: '8' }, 'lbs', 'reps-weight');
    expect(errs).toEqual({});
  });

  it('does not check weight for reps-only mode', () => {
    const errs = getSetFieldErrors({ weight: '-50', reps: '10', rpe: '' }, 'lbs', 'reps');
    expect(errs.weight).toBeUndefined();
  });

  it('does not check reps for time-only mode', () => {
    const errs = getSetFieldErrors({ weight: '', reps: '99999', rpe: '' }, 'lbs', 'time');
    expect(errs.reps).toBeUndefined();
  });

  it('allows 0 weight for bodyweight exercises', () => {
    const errs = getSetFieldErrors({ weight: '0', reps: '10', rpe: '' }, 'lbs', 'reps-weight', true);
    expect(errs.weight).toBeUndefined();
  });

  it('hasFieldErrors returns true when any field invalid', () => {
    expect(hasFieldErrors({ weight: 'bad' })).toBe(true);
    expect(hasFieldErrors({})).toBe(false);
  });
});

describe('isBodyweightExercise', () => {
  it('detects "Bodyweight" in name', () => {
    expect(isBodyweightExercise('Pull-up (Bodyweight)')).toBe(true);
    expect(isBodyweightExercise('bodyweight squat')).toBe(true);
  });

  it('returns false for normal names', () => {
    expect(isBodyweightExercise('Bench Press')).toBe(false);
  });
});

describe('canCompleteSet', () => {
  it('blocks completion with empty weight', () => {
    expect(canCompleteSet('', '10', 'kg')).toBe(false);
  });

  it('blocks completion with empty reps', () => {
    expect(canCompleteSet('100', '', 'kg')).toBe(false);
  });

  it('blocks completion with negative weight', () => {
    expect(canCompleteSet('-50', '10', 'kg')).toBe(false);
  });

  it('allows valid set', () => {
    expect(canCompleteSet('100', '10', 'kg')).toBe(true);
  });

  it('allows cardio with time only', () => {
    expect(canCompleteSet('', '', 'kg', false, true, '30')).toBe(true);
  });

  it('blocks cardio with empty time', () => {
    expect(canCompleteSet('', '', 'kg', false, true, '')).toBe(false);
  });
});
