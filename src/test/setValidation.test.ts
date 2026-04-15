import { describe, it, expect } from 'vitest';
import { validateWeight, validateReps, validateRpe, canCompleteSet } from '@/utils/setValidation';

describe('validateWeight', () => {
  it('rejects empty', () => {
    expect(validateWeight('', 'kg').valid).toBe(false);
  });

  it('rejects negative', () => {
    expect(validateWeight('-50', 'kg').valid).toBe(false);
    expect(validateWeight('-50', 'kg').error).toMatch(/negative/i);
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

  it('rejects decimals', () => {
    expect(validateReps('10.5').valid).toBe(false);
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
    expect(canCompleteSet('', '30', 'kg', false, true)).toBe(true);
  });
});
