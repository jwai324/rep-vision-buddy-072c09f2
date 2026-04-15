import { describe, it, expect, vi } from 'vitest';
import {
  normalizeSearch,
  fuzzyIncludes,
  scoreExercise,
  searchExercises,
  parseAliases,
  validateAliases,
} from '@/utils/exerciseSearch';
import type { Exercise } from '@/data/exercises';

const makeExercise = (overrides: Partial<Exercise> & { name: string }): Exercise => ({
  id: overrides.name.toLowerCase().replace(/\s+/g, '-'),
  primaryBodyPart: 'Biceps',
  equipment: 'Dumbbell',
  difficulty: 'Beginner',
  exerciseType: 'Isolation',
  movementPattern: 'Curl',
  secondaryMuscles: [],
  ...overrides,
});

describe('normalizeSearch', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeSearch('Pull-Ups')).toBe('pullup');
  });

  it('collapses whitespace', () => {
    expect(normalizeSearch('  lat   pull  down  ')).toBe('lat pull down');
  });

  it('strips trailing s', () => {
    expect(normalizeSearch('curls')).toBe('curl');
  });
});

describe('fuzzyIncludes', () => {
  it('matches subsequence', () => {
    expect(fuzzyIncludes('dumbbell bicep curl', 'dbcurl')).toBe(true);
  });

  it('rejects non-subsequence', () => {
    expect(fuzzyIncludes('bench press', 'zpress')).toBe(false);
  });
});

describe('searchExercises', () => {
  const exercises: Exercise[] = [
    makeExercise({ name: 'Dumbbell Bicep Curl', aliases: ['bicep curl', 'db curl', 'arm curl'] }),
    makeExercise({ name: 'Barbell Curl', equipment: 'Barbell' }),
    makeExercise({ name: 'Hammer Curl' }),
    makeExercise({ name: 'Pull-Ups', primaryBodyPart: 'Back', equipment: 'Bodyweight', exerciseType: 'Compound', aliases: ['pullup', 'chin up'] }),
  ];

  it('"bicep curl" finds Dumbbell Bicep Curl via alias', () => {
    const results = searchExercises(exercises, 'bicep curl');
    expect(results.some(e => e.name === 'Dumbbell Bicep Curl')).toBe(true);
  });

  it('"db curl" finds Dumbbell Bicep Curl via alias', () => {
    const results = searchExercises(exercises, 'db curl');
    expect(results.some(e => e.name === 'Dumbbell Bicep Curl')).toBe(true);
  });

  it('"pull ups" finds Pull-Ups (punctuation tolerance)', () => {
    const results = searchExercises(exercises, 'pull ups');
    expect(results.some(e => e.name === 'Pull-Ups')).toBe(true);
  });

  it('canonical exact match ranks highest', () => {
    const results = searchExercises(exercises, 'Barbell Curl');
    expect(results[0].name).toBe('Barbell Curl');
  });

  it('deduplicates — exercise matched by both name and alias returns once', () => {
    const results = searchExercises(exercises, 'curl');
    const ids = results.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns all exercises when query is empty', () => {
    const results = searchExercises(exercises, '');
    expect(results.length).toBe(exercises.length);
  });
});

describe('parseAliases', () => {
  it('splits on commas and lowercases', () => {
    expect(parseAliases('Bicep Curl, DB Curl, Arm Curl')).toEqual([
      'bicep curl',
      'db curl',
      'arm curl',
    ]);
  });

  it('handles null/empty', () => {
    expect(parseAliases(null)).toEqual([]);
    expect(parseAliases('')).toEqual([]);
  });
});

describe('validateAliases', () => {
  const canonicalNames = new Set(['barbell curl', 'hammer curl']);

  it('skips aliases that collide with canonical names', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateAliases(
      ['barbell curl', 'db curl'],
      canonicalNames,
      'Dumbbell Bicep Curl'
    );
    expect(result).toEqual(['db curl']);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('keeps all aliases when no collisions', () => {
    const result = validateAliases(
      ['arm curl', 'db curl'],
      canonicalNames,
      'Dumbbell Bicep Curl'
    );
    expect(result).toEqual(['arm curl', 'db curl']);
  });
});
