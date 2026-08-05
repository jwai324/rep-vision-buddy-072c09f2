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

describe('generateFutureWorkouts weekday collision handling', () => {
  it('places every day on a unique weekday when the AI duplicates a weekday assignment', () => {
    // Reproduces the "Day 4 got weekday=3, colliding with Day 3" bug: without
    // normalization, Thursday silently becomes a rest day and Day 4 vanishes.
    const program = baseProgram({
      days: [
        { label: 'Day 1', templateId: 'tpl-mon', frequency: { type: 'weekly', weekday: 1 } },
        { label: 'Day 2', templateId: 'tpl-tue', frequency: { type: 'weekly', weekday: 2 } },
        { label: 'Day 3', templateId: 'tpl-wed', frequency: { type: 'weekly', weekday: 3 } },
        { label: 'Day 4', templateId: 'tpl-thu', frequency: { type: 'weekly', weekday: 3 } },
        { label: 'Day 5', templateId: 'rest', frequency: { type: 'weekly', weekday: 5 } },
        { label: 'Day 6', templateId: 'tpl-sat', frequency: { type: 'weekly', weekday: 6 } },
        { label: 'Day 7', templateId: 'rest', frequency: { type: 'weekly', weekday: 0 } },
      ],
    });

    const fws = generateFutureWorkouts(program);
    const training = fws.filter(f => f.templateId !== 'rest');
    const rest = fws.filter(f => f.templateId === 'rest');

    expect(training).toHaveLength(5);
    expect(rest).toHaveLength(2);

    // Aug 6 2026 is a Thursday — Day 4 must land here, not become rest.
    expect(scheduleFor(fws, '2026-08-06')).toEqual([
      expect.objectContaining({ templateId: 'tpl-thu', label: 'Day 4' }),
    ]);

    // Every training day of the week should be represented exactly once.
    const dates = training.map(f => f.date).sort();
    expect(new Set(dates).size).toBe(5);
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

  it('reassigns out-of-range weekdays to the first unused weekday', () => {
    const program = baseProgram({
      days: [
        { label: 'Day 1', templateId: 'tpl-a', frequency: { type: 'weekly', weekday: 1 } },
        // 99 is nonsense — should be reassigned to the first still-open weekday (0 = Sun).
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
