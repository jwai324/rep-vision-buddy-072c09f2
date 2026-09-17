import { describe, it, expect } from 'vitest';
import { sanitizeFrequency, sanitizeProgramDays, monthlyOccurrences } from '@/utils/programFrequency';
import { generateFutureWorkouts } from '@/hooks/useStorage';
import type { WorkoutProgram } from '@/types/workout';

describe('sanitizeFrequency', () => {
  it('rejects the interval that used to hang the scheduler', () => {
    expect(sanitizeFrequency({ type: 'everyNDays', interval: 0 })).toBeUndefined();
    expect(sanitizeFrequency({ type: 'everyNDays', interval: -3 })).toBeUndefined();
    expect(sanitizeFrequency({ type: 'everyNDays', interval: 2.5 })).toBeUndefined();
    expect(sanitizeFrequency({ type: 'everyNDays', interval: '3' })).toEqual({ type: 'everyNDays', interval: 3 });
  });

  it('keeps only a real weekday and a real day of month', () => {
    expect(sanitizeFrequency({ type: 'weekly', weekday: 7 })).toBeUndefined();
    expect(sanitizeFrequency({ type: 'weekly', weekday: 6 })).toEqual({ type: 'weekly', weekday: 6 });
    expect(sanitizeFrequency({ type: 'monthly', dayOfMonth: 0 })).toBeUndefined();
    expect(sanitizeFrequency({ type: 'monthly', dayOfMonth: 31 })).toEqual({ type: 'monthly', dayOfMonth: 31 });
    expect(sanitizeFrequency({ type: 'yearly' })).toBeUndefined();
    expect(sanitizeFrequency(null)).toBeUndefined();
  });

  it('turns an invalid frequency into an unscheduled day rather than dropping the day', () => {
    const days = sanitizeProgramDays([
      { label: 'A', templateId: 't1', frequency: { type: 'everyNDays', interval: 0 } },
      { label: 'B', templateId: 't2', frequency: { type: 'weekly', weekday: 2 } },
    ]);
    expect(days).toHaveLength(2);
    expect(days[0].frequency).toBeUndefined();
    expect(days[1].frequency).toEqual({ type: 'weekly', weekday: 2 });
  });
});

describe('monthlyOccurrences', () => {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('clamps the 31st to each month\'s length instead of overflowing', () => {
    // setDate(31) on January is fine; on February it used to become March 3,
    // and every later setMonth(+1) then carried the slip forward for good.
    const out = monthlyOccurrences(new Date(2026, 0, 1), new Date(2026, 5, 1), 31).map(ymd);
    expect(out).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('handles a leap year and a start after the day has passed this month', () => {
    const out = monthlyOccurrences(new Date(2028, 1, 15), new Date(2028, 4, 1), 29).map(ymd);
    expect(out).toEqual(['2028-02-29', '2028-03-29', '2028-04-29']);
  });

  it('returns nothing for a day outside 1–31', () => {
    expect(monthlyOccurrences(new Date(2026, 0, 1), new Date(2027, 0, 1), 0)).toEqual([]);
  });
});

describe('generateFutureWorkouts with hostile input', () => {
  it('terminates on an everyNDays interval of 0 from a shared or restored program', () => {
    const program: WorkoutProgram = {
      id: 'p', name: 'Bad', durationWeeks: 4, startDate: '2026-09-01',
      days: [{ label: 'X', templateId: 't', frequency: { type: 'everyNDays', interval: 0 } }],
    };
    const out = generateFutureWorkouts(program);
    // The day is unscheduled, so the four weeks come back as rest days only.
    expect(out.every(fw => fw.templateId === 'rest')).toBe(true);
    expect(out.length).toBe(28);
  });

  it('schedules a monthly day on the 31st without drifting', () => {
    const program: WorkoutProgram = {
      id: 'p', name: 'Monthly', durationWeeks: 20, startDate: '2026-01-01',
      days: [{ label: 'Long', templateId: 't', frequency: { type: 'monthly', dayOfMonth: 31 } }],
    };
    const dates = generateFutureWorkouts(program).filter(fw => fw.templateId === 't').map(fw => fw.date);
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});
