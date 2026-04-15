import type { Exercise } from '@/data/exercises';

/**
 * Normalize a string for search comparison:
 * lowercase, strip punctuation, collapse whitespace, strip trailing "s"
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '');
}

/**
 * Subsequence match: every char in query appears in order within target.
 */
export function fuzzyIncludes(target: string, query: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const idx = target.indexOf(query[qi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

export type SearchMatch = {
  exercise: Exercise;
  rank: number; // lower = better
};

/**
 * Score an exercise against a normalized search query.
 * Returns rank 0-4 (lower = better) or -1 for no match.
 *
 * Ranking: exact canonical > canonical startsWith > canonical contains >
 *          alias exact > alias contains
 */
export function scoreExercise(ex: Exercise, normalizedQuery: string): number {
  const normName = normalizeSearch(ex.name);

  // Canonical name matches
  if (normName === normalizedQuery) return 0;
  if (normName.startsWith(normalizedQuery)) return 1;
  if (normName.includes(normalizedQuery)) return 2;

  // Alias matches
  if (ex.aliases) {
    for (const alias of ex.aliases) {
      const normAlias = normalizeSearch(alias);
      if (normAlias === normalizedQuery) return 3;
    }
    for (const alias of ex.aliases) {
      const normAlias = normalizeSearch(alias);
      if (normAlias.includes(normalizedQuery)) return 4;
    }
  }

  return -1; // no match
}

/**
 * Multi-word search: all words must appear in canonical name/bodyPart/equipment OR aliases.
 * Returns rank (lower = better) or -1 for no match.
 */
export function scoreExerciseMultiWord(ex: Exercise, searchWords: string[]): number {
  const canonTarget = normalizeSearch(`${ex.name} ${ex.primaryBodyPart} ${ex.equipment}`);
  const aliasTarget = ex.aliases
    ? normalizeSearch(ex.aliases.join(' '))
    : '';

  const combinedTarget = `${canonTarget} ${aliasTarget}`;
  const allMatch = searchWords.every(w => combinedTarget.includes(w));
  if (!allMatch) return -1;

  // Determine best rank based on where the match is
  const canonOnly = searchWords.every(w => canonTarget.includes(w));
  if (canonOnly) {
    // Check single-query ranking against canonical name
    const joinedQuery = searchWords.join(' ');
    const normName = normalizeSearch(ex.name);
    if (normName === joinedQuery) return 0;
    if (normName.startsWith(joinedQuery)) return 1;
    if (normName.includes(joinedQuery)) return 2;
    return 2; // multi-word canonical match
  }

  // Matched via aliases
  const joinedQuery = searchWords.join(' ');
  if (ex.aliases) {
    for (const alias of ex.aliases) {
      if (normalizeSearch(alias) === joinedQuery) return 3;
    }
  }
  return 4; // alias contains
}

/**
 * Search exercises with alias support and ranking.
 * Returns deduplicated results sorted by rank.
 */
export function searchExercises(exercises: Exercise[], query: string): Exercise[] {
  if (!query.trim()) return exercises;

  const searchWords = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (searchWords.length === 0) return exercises;

  // Primary: multi-word matching with ranking
  const scored: SearchMatch[] = [];
  for (const ex of exercises) {
    const rank = scoreExerciseMultiWord(ex, searchWords);
    if (rank >= 0) {
      scored.push({ exercise: ex, rank });
    }
  }

  if (scored.length > 0) {
    scored.sort((a, b) => a.rank - b.rank);
    return scored.map(s => s.exercise);
  }

  // Fallback: fuzzy subsequence matching
  const joinedQuery = searchWords.join('');
  return exercises.filter(ex => {
    const target = normalizeSearch(`${ex.name} ${ex.primaryBodyPart} ${ex.equipment}`);
    return fuzzyIncludes(target, joinedQuery);
  });
}

/**
 * Parse Notion aliases rich_text into a string array.
 * Splits on commas, trims, lowercases, filters empty.
 */
export function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validate aliases against canonical names.
 * Returns only aliases that don't collide with any canonical exercise name.
 */
export function validateAliases(
  aliases: string[],
  canonicalNames: Set<string>,
  exerciseName: string,
): string[] {
  return aliases.filter(alias => {
    const normAlias = normalizeSearch(alias);
    if (canonicalNames.has(normAlias)) {
      console.warn(
        `[Exercise Aliases] Skipping alias "${alias}" for "${exerciseName}" — collides with canonical name`
      );
      return false;
    }
    return true;
  });
}
