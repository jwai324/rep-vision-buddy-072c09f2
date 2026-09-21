import { describe, it, expect } from 'vitest';
import { EXERCISE_DATABASE } from '@/data/exercises';

/**
 * The bundled library is keyed by id everywhere downstream, and the two shapes
 * of lookup built over it disagree when an id appears twice: `new Map(...)`
 * keeps the last row (Dashboard, VolumeTab, FrequencyTab, BalanceTab) while
 * `.find(...)` keeps the first (ExerciseDetailModal, SessionSummary), so one
 * duplicated id silently attributes the same logged sets to two body parts.
 * Names are the user-facing key — `isDuplicateExerciseName` refuses a custom
 * exercise that collides with one — and the picker shows a repeat as two rows
 * that select together.
 *
 * Both invariants held only by convention until 'medicine-ball-chest-pass' was
 * shipped twice. These assertions are the guard.
 */

/** Same normalization `isDuplicateExerciseName` applies to custom exercises. */
const normalizeName = (name: string) => name.trim().toLowerCase();

const duplicates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
};

describe('EXERCISE_DATABASE integrity', () => {
  it('has no duplicate ids', () => {
    expect(duplicates(EXERCISE_DATABASE.map(ex => ex.id))).toEqual([]);
  });

  it('has no duplicate names', () => {
    expect(duplicates(EXERCISE_DATABASE.map(ex => normalizeName(ex.name)))).toEqual([]);
  });

  it('still holds the whole library', () => {
    // Deliberately a floor, not the exact count: adding an exercise is normal,
    // losing a few hundred is the accident worth catching.
    expect(EXERCISE_DATABASE.length).toBeGreaterThan(300);
    expect(EXERCISE_DATABASE.every(ex => ex.id && ex.name)).toBe(true);
  });

  it('keeps the Full Body Medicine Ball Chest Pass, and only that one', () => {
    const rows = EXERCISE_DATABASE.filter(ex => ex.id === 'medicine-ball-chest-pass');
    expect(rows).toHaveLength(1);
    expect(rows[0].primaryBodyPart).toBe('Full Body');
  });
});
