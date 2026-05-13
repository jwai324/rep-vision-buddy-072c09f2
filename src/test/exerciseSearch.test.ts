import { describe, it, expect, vi } from 'vitest';
import {
  normalizeSearch,
  fuzzyIncludes,
  levenshtein,
  scoreExercise,
  scoreExerciseMultiWord,
  searchExercises,
  tokenize,
  parseAliases,
  validateAliases,
  isDuplicateExerciseName,
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

describe('tokenize', () => {
  it('splits on whitespace and lowercases', () => {
    expect(tokenize('db curl')).toEqual(['db', 'curl']);
  });

  it('handles multiple spaces', () => {
    expect(tokenize('  bicep  curl  ')).toEqual(['bicep', 'curl']);
  });

  it('single word returns one-element array', () => {
    expect(tokenize('dumbbell')).toEqual(['dumbbell']);
  });

  it('empty string returns empty array', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('normalizeSearch', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeSearch('Pull-Ups')).toBe('pullup');
  });

  it('collapses whitespace', () => {
    expect(normalizeSearch('  lat   pull  down  ')).toBe('lat pull down');
  });

  it('strips trailing s from words > 3 chars', () => {
    expect(normalizeSearch('curls')).toBe('curl');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('dumbbell', 'dumbbell')).toBe(0);
  });

  it('returns correct distance for typo', () => {
    expect(levenshtein('dumbell', 'dumbbell')).toBeLessThanOrEqual(2);
  });

  it('returns correct distance for unrelated strings', () => {
    expect(levenshtein('abc', 'xyz')).toBe(3);
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

describe('scoreExerciseMultiWord AND-filter', () => {
  const dbCurl = makeExercise({ name: 'Dumbbell Bicep Curl', aliases: ['bicep curl', 'db curl', 'arm curl'] });
  const skullCrusher = makeExercise({ name: 'Dumbbell Skull Crusher', primaryBodyPart: 'Triceps', aliases: ['skull crusher'] });

  it('matches exercise when ALL tokens are found', () => {
    expect(scoreExerciseMultiWord(dbCurl, ['db', 'curl'])).toBeGreaterThanOrEqual(0);
  });

  it('rejects exercise when ANY token is missing', () => {
    expect(scoreExerciseMultiWord(skullCrusher, ['db', 'curl'])).toBe(-1);
  });

  it('fuzzy token still requires all tokens — "dumbell" matches dumbbell but "snatch" must also match', () => {
    const snatch = makeExercise({ name: 'Dumbbell Snatch', primaryBodyPart: 'Shoulders' });
    // "dumbell" fuzzy-matches "dumbbell", but "curl" does not match "snatch"
    expect(scoreExerciseMultiWord(snatch, ['dumbell', 'curl'])).toBe(-1);
  });
});

describe('searchExercises', () => {
  const exercises: Exercise[] = [
    makeExercise({ name: 'Dumbbell Bicep Curl', aliases: ['bicep curl', 'db curl', 'arm curl'] }),
    makeExercise({ name: 'Barbell Curl', equipment: 'Barbell' }),
    makeExercise({ name: 'Hammer Curl' }),
    makeExercise({ name: 'Pull-Ups', primaryBodyPart: 'Back', equipment: 'Bodyweight', exerciseType: 'Compound', aliases: ['pullup', 'chin up'] }),
    makeExercise({ name: 'Dumbbell Skull Crusher', primaryBodyPart: 'Triceps', aliases: ['skull crusher'] }),
    makeExercise({ name: 'Dumbbell Snatch', primaryBodyPart: 'Shoulders', equipment: 'Dumbbell' }),
    makeExercise({ name: 'EZ-Bar Curl', equipment: 'EZ-Bar', aliases: ['ez curl'] }),
    makeExercise({ name: 'Cable Curl', equipment: 'Cable', aliases: ['cable bicep curl'] }),
    makeExercise({ name: 'Machine Bicep Curl', equipment: 'Machine', aliases: ['machine curl'] }),
  ];

  it('"bicep curl" finds Dumbbell Bicep Curl via alias', () => {
    const results = searchExercises(exercises, 'bicep curl');
    expect(results.some(e => e.name === 'Dumbbell Bicep Curl')).toBe(true);
  });

  it('"bicep curl" also finds EZ-Bar Curl, Cable Curl, Machine Bicep Curl', () => {
    const results = searchExercises(exercises, 'bicep curl');
    expect(results.some(e => e.name === 'EZ-Bar Curl')).toBe(true);
    expect(results.some(e => e.name === 'Cable Curl')).toBe(true);
    expect(results.some(e => e.name === 'Machine Bicep Curl')).toBe(true);
  });

  it('"db curl" finds Dumbbell Bicep Curl via alias', () => {
    const results = searchExercises(exercises, 'db curl');
    expect(results.some(e => e.name === 'Dumbbell Bicep Curl')).toBe(true);
  });

  it('"db curl" does NOT return Dumbbell Skull Crusher', () => {
    const results = searchExercises(exercises, 'db curl');
    expect(results.some(e => e.name === 'Dumbbell Skull Crusher')).toBe(false);
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

  it('"bicepcurl" (no space) finds results via fuzzy subsequence', () => {
    const results = searchExercises(exercises, 'bicepcurl');
    expect(results.some(e => e.name.includes('Curl'))).toBe(true);
  });

  it('"dumbell curl" (typo) finds Dumbbell Bicep Curl via Levenshtein', () => {
    const results = searchExercises(exercises, 'dumbell curl');
    expect(results.some(e => e.name === 'Dumbbell Bicep Curl')).toBe(true);
  });

  it('"dumbell curl" does NOT return Dumbbell Snatch', () => {
    const results = searchExercises(exercises, 'dumbell curl');
    expect(results.some(e => e.name === 'Dumbbell Snatch')).toBe(false);
  });

  it('"zzzznotreal" returns empty — no OR fallback', () => {
    const results = searchExercises(exercises, 'zzzznotreal');
    expect(results).toHaveLength(0);
  });

  it('"db xyz" returns empty when one token matches nothing', () => {
    const results = searchExercises(exercises, 'db xyz');
    expect(results).toHaveLength(0);
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

describe('isDuplicateExerciseName', () => {
  const canonical = [makeExercise({ name: 'Dumbbell Curl' })];
  const custom = [makeExercise({ name: 'My Custom Press' })];

  it('detects duplicate canonical name (case-insensitive)', () => {
    expect(isDuplicateExerciseName('dumbbell curl', canonical, custom)).toBe(true);
  });

  it('detects duplicate custom name', () => {
    expect(isDuplicateExerciseName('MY CUSTOM PRESS', canonical, custom)).toBe(true);
  });

  it('allows unique name', () => {
    expect(isDuplicateExerciseName('Brand New Exercise', canonical, custom)).toBe(false);
  });

  it('excludes self when editing', () => {
    expect(isDuplicateExerciseName('Dumbbell Curl', canonical, custom, 'dumbbell-curl')).toBe(false);
  });
});
