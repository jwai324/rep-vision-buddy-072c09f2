import { describe, it, expect } from 'vitest';
import { generateFutureWorkouts } from '@/hooks/useStorage';
import type { WorkoutProgram } from '@/types/workout';

function baseProgram(overrides: Partial<WorkoutProgram> = {}): WorkoutProgram {
  return {
    id: 'prog-1',
    name: 'Hybrid',
    startDate: '2026-08-05',
    durationWeeks: 1,
    days: [],
    ...overrides,
  };
}

function scheduleFor(fws: { date: string; templateId: string; label: string }[], date: string) {
  return fws.filter(f => f.date === date);
}

describe('generateFutureWorkouts multi-workout scheduling', () => {
  it('keeps every workout when two ProgramDays share the same weekday', () => {
    // Two entries on Wednesday (weekday 3) — the user wants both scheduled
    // on the same date, not silently spread apart.
    const program = baseProgram({
      days: [
        { label: 'Wed AM', templateId: 'tpl-am', frequency: { type: 'weekly', weekday: 3 } },
        { label: 'Wed PM', templateId: 'tpl-pm', frequency: { type: 'weekly', weekday: 3 } },
      ],
    });

    const fws = generateFutureWorkouts(program);
    const training = fws.filter(f => f.templateId !== 'rest');

    expect(training).toHaveLength(2);
    // Aug 5 2026 is Wednesday — both workouts land here.
    expect(scheduleFor(fws, '2026-08-05')).toEqual([
      expect.objectContaining({ templateId: 'tpl-am', label: 'Wed AM' }),
      expect.objectContaining({ templateId: 'tpl-pm', label: 'Wed PM' }),
    ]);
    // Aug 5 shouldn't also generate a rest-day entry.
    expect(fws.filter(f => f.date === '2026-08-05' && f.templateId === 'rest')).toHaveLength(0);
  });

  it('leaves valid, unique weekday assignments untouched', () => {
    const program = baseProgram({
      days: [
        { label: 'Push', templateId: 'tpl-push', frequency: { type: 'weekly', weekday: 1 } },
        { label: 'Pull', templateId: 'tpl-pull', frequency: { type: 'weekly', weekday: 3 } },
        { label: 'Legs', templateId: 'tpl-legs', frequency: { type: 'weekly', weekday: 5 } },
      ],
    });

    const fws = generateFutureWorkouts(program);
    const training = fws.filter(f => f.templateId !== 'rest');
    expect(training).toHaveLength(3);
    // Aug 5 (Wed) — Pull.
    expect(scheduleFor(fws, '2026-08-05')).toEqual([
      expect.objectContaining({ templateId: 'tpl-pull' }),
    ]);
    // Aug 7 (Fri) — Legs.
    expect(scheduleFor(fws, '2026-08-07')).toEqual([
      expect.objectContaining({ templateId: 'tpl-legs' }),
    ]);
    // Aug 10 (next Mon) — Push.
    expect(scheduleFor(fws, '2026-08-10')).toEqual([
      expect.objectContaining({ templateId: 'tpl-push' }),
    ]);
  });

  it('clamps out-of-range weekdays to Sunday (weekday 0)', () => {
    const program = baseProgram({
      days: [
        { label: 'Day 1', templateId: 'tpl-a', frequency: { type: 'weekly', weekday: 1 } },
        // 99 is nonsense — clamped to weekday 0 (Sunday).
        { label: 'Day 2', templateId: 'tpl-b', frequency: { type: 'weekly', weekday: 99 } },
      ],
    });

    const fws = generateFutureWorkouts(program);
    const training = fws.filter(f => f.templateId !== 'rest');
    expect(training).toHaveLength(2);
    // Aug 9 2026 is Sunday.
    expect(scheduleFor(fws, '2026-08-09')).toEqual([
      expect.objectContaining({ templateId: 'tpl-b' }),
    ]);
  });
});
