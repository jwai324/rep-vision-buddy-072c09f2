import { describe, it, expect } from 'vitest';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { searchExercises, scoreExerciseMultiWord } from '@/utils/exerciseSearch';
import type { Exercise } from '@/data/exercises';

const names = (list: Exercise[]) => list.map(e => e.name);

describe('spelling tolerance is scoped to names and aliases', () => {
  it('"curl" returns no Full Body cardio entries — levenshtein("full","curl") is 2', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'curl');
    expect(results.some(e => e.name === 'Assault Bike')).toBe(false);
    expect(results.filter(e => e.primaryBodyPart === 'Full Body')).toHaveLength(0);
  });

  it('every "curl" result actually has curl in its name', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'curl');
    expect(results.length).toBeGreaterThan(0);
    for (const ex of results) {
      expect(ex.name.toLowerCase()).toContain('curl');
    }
  });

  it('"curl" returns a small slice of the library, not a third of it', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'curl');
    expect(results.length).toBeLessThan(EXERCISE_DATABASE.length / 4);
  });

  it('"pull" no longer drags in every Full Body row', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'pull');
    expect(results.every(e => /pull/i.test(e.name))).toBe(true);
  });

  it('a body-part label is never spell-corrected into a match', () => {
    const fullBody: Exercise = {
      id: 'x', name: 'Assault Bike', primaryBodyPart: 'Full Body', equipment: 'Machine',
      difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Push', secondaryMuscles: [],
    };
    expect(scoreExerciseMultiWord(fullBody, ['curl'], 'fuzzy')).toBe(-1);
  });

  it('an equipment label is never spell-corrected into a match', () => {
    const banded: Exercise = {
      id: 'y', name: 'Chest Press', primaryBodyPart: 'Chest', equipment: 'Band',
      difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Push', secondaryMuscles: [],
    };
    // "bend" is within 1 of the equipment word "band" but nothing in the name.
    expect(scoreExerciseMultiWord(banded, ['bend'], 'fuzzy')).toBe(-1);
  });
});

describe('near-miss spelling is a fallback, not a widener', () => {
  const exercises: Exercise[] = [
    { id: 'a', name: 'Barbell Curl', primaryBodyPart: 'Biceps', equipment: 'Barbell', difficulty: 'Beginner', exerciseType: 'Isolation', movementPattern: 'Flexion', secondaryMuscles: [] },
    { id: 'b', name: 'Curb Step-Up', primaryBodyPart: 'Quads', equipment: 'Bodyweight', difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Lunge', secondaryMuscles: [] },
  ];

  it('a word that matches exactly does not also pull in its near misses', () => {
    // "curb" is within 1 of "curl", but "Barbell Curl" matches "curl" as typed,
    // so the fuzzy pass never runs.
    expect(names(searchExercises(exercises, 'curl'))).toEqual(['Barbell Curl']);
  });

  it('a genuine typo still finds its exercise', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'dumbell curl');
    expect(results.some(e => e.name === 'Dumbbell Curl')).toBe(true);
  });

  it('a genuine single-word typo still finds its exercise', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'squatt');
    expect(results.some(e => /squat/i.test(e.name))).toBe(true);
  });
});

describe('ranking', () => {
  it('an exact name match ranks first', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'Barbell Curl');
    expect(results[0].name).toBe('Barbell Curl');
  });

  it('an exact name match outranks a longer name that merely contains it', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'hammer curl');
    expect(results[0].name).toBe('Hammer Curl');
    expect(results.some(e => e.name === 'Rope Hammer Curl')).toBe(true);
  });

  it('a name that starts with the query outranks one that only contains it', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'pull');
    const pullUp = results.findIndex(e => e.name === 'Pull-Up');
    const facePull = results.findIndex(e => e.name === 'Face Pull');
    expect(pullUp).toBeGreaterThanOrEqual(0);
    expect(facePull).toBeGreaterThan(pullUp);
  });
});

describe('the "ez" shorthand matches how the library spells EZ Bar', () => {
  // The picker searches the built-in library plus the user's custom exercises,
  // and the library has exactly one EZ Bar exercise, so an EZ-bar curl can only
  // come from a custom one.
  const ezBarCurl: Exercise = {
    id: 'custom-ez-bar-curl', name: 'EZ Bar Curl', primaryBodyPart: 'Biceps', equipment: 'EZ Bar',
    difficulty: 'Beginner', exerciseType: 'Isolation', movementPattern: 'Flexion', secondaryMuscles: [],
  };
  const withCustom = [...EXERCISE_DATABASE, ezBarCurl];

  it('"ez" returns the EZ Bar exercise, first', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'ez');
    expect(results[0]?.name).toBe('EZ Bar Skull Crusher');
  });

  it('"ez" no longer drags in trap-bar exercises', () => {
    const results = searchExercises(EXERCISE_DATABASE, 'ez');
    expect(results.some(e => /trap bar|t-bar/i.test(e.name))).toBe(false);
    expect(results.every(e => /ez bar/i.test(e.name))).toBe(true);
  });

  it('"ez curl" finds an EZ-bar curl and ranks it first', () => {
    const results = searchExercises(withCustom, 'ez curl');
    expect(results[0]?.name).toBe('EZ Bar Curl');
  });

  it('"ez" returns both EZ Bar rows and nothing else', () => {
    expect(names(searchExercises(withCustom, 'ez')).sort()).toEqual([
      'EZ Bar Curl',
      'EZ Bar Skull Crusher',
    ]);
  });

  it('"ez bar" spelled out matches the same row', () => {
    expect(names(searchExercises(EXERCISE_DATABASE, 'ez bar'))).toEqual(['EZ Bar Skull Crusher']);
  });

  it('the trade-off: "ez" implies "bar", so an EZ-less-bar custom name misses', () => {
    const ezCurl: Exercise = {
      id: 'custom-ez-curl', name: 'EZ Curl', primaryBodyPart: 'Biceps', equipment: 'Cable',
      difficulty: 'Beginner', exerciseType: 'Isolation', movementPattern: 'Flexion', secondaryMuscles: [],
    };
    expect(searchExercises([ezCurl], 'ez')).toHaveLength(0);
    expect(searchExercises([ezCurl], 'ez curl')).toHaveLength(0);
    // It is still reachable by the words it is actually spelled with.
    expect(names(searchExercises([ezCurl], 'curl'))).toEqual(['EZ Curl']);
  });
});

describe('the exercise library has one Swimming', () => {
  it('contains exactly one exercise named Swimming', () => {
    const swimming = EXERCISE_DATABASE.filter(e => e.name === 'Swimming');
    expect(swimming).toHaveLength(1);
    expect(swimming[0].id).toBe('swimming-full-body');
  });
});
