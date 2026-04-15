import type { Exercise } from '@/data/exercises';

/**
 * Normalize a string for search comparison:
 * lowercase, strip punctuation, collapse whitespace, strip trailing "s" (words > 3 chars)
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(\w{4,})s\b/g, '$1') // only strip trailing s from words > 3 chars
    .replace(/s$/, ''); // final trailing s
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

/**
 * Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export type SearchMatch = {
  exercise: Exercise;
  rank: number; // lower = better
};

/**
 * Score an exercise against a normalized search query.
 * Returns rank 0-5 (lower = better) or -1 for no match.
 *
 * Ranking: exact canonical > canonical startsWith > canonical contains >
 *          alias exact > alias contains > fuzzy (Levenshtein ≤ 2)
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

  // Fuzzy: Levenshtein ≤ 2 for queries of length ≥ 4 against name words
  if (normalizedQuery.length >= 4) {
    const nameWords = normName.split(' ');
    for (const word of nameWords) {
      if (word.length >= 3 && levenshtein(word, normalizedQuery) <= 2) return 5;
    }
    if (ex.aliases) {
      for (const alias of ex.aliases) {
        const aliasWords = normalizeSearch(alias).split(' ');
        for (const word of aliasWords) {
          if (word.length >= 3 && levenshtein(word, normalizedQuery) <= 2) return 5;
        }
      }
    }
  }

  return -1; // no match
}

/**
 * Multi-word search: all words must appear in canonical name/bodyPart/equipment OR aliases.
 * Includes fuzzy matching for individual tokens.
 * Returns rank (lower = better) or -1 for no match.
 */
export function scoreExerciseMultiWord(ex: Exercise, searchWords: string[]): number {
  const canonTarget = normalizeSearch(`${ex.name} ${ex.primaryBodyPart} ${ex.equipment}`);
  const aliasTarget = ex.aliases
    ? normalizeSearch(ex.aliases.join(' '))
    : '';

  const combinedTarget = `${canonTarget} ${aliasTarget}`;
  const combinedWords = combinedTarget.split(' ');

  // Check if all search words match (exact substring or fuzzy)
  const allMatch = searchWords.every(w => {
    // Exact substring match
    if (combinedTarget.includes(w)) return true;
    // Fuzzy match: Levenshtein ≤ 2 for tokens ≥ 4 chars
    if (w.length >= 4) {
      return combinedWords.some(cw => cw.length >= 3 && levenshtein(cw, w) <= 2);
    }
    return false;
  });

  if (!allMatch) return -1;

  // Determine best rank based on where the match is
  const canonOnly = searchWords.every(w => {
    if (canonTarget.includes(w)) return true;
    if (w.length >= 4) {
      return canonTarget.split(' ').some(cw => cw.length >= 3 && levenshtein(cw, w) <= 2);
    }
    return false;
  });

  if (canonOnly) {
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
 * Search exercises with alias support, ranking, and fuzzy matching.
 * Also handles no-space queries by trying concatenated matching.
 * Returns deduplicated results sorted by rank.
 */
export function searchExercises(exercises: Exercise[], query: string): Exercise[] {
  if (!query.trim()) return exercises;

  const normalized = normalizeSearch(query);
  const searchWords = normalized.split(/\s+/).filter(Boolean);
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

  // Fallback for no-space queries (e.g., "bicepcurl"): try single-token scoring
  if (searchWords.length === 1) {
    const singleScored: SearchMatch[] = [];
    for (const ex of exercises) {
      const rank = scoreExercise(ex, normalized);
      if (rank >= 0) {
        singleScored.push({ exercise: ex, rank });
      }
    }
    if (singleScored.length > 0) {
      singleScored.sort((a, b) => a.rank - b.rank);
      return singleScored.map(s => s.exercise);
    }
  }

  // Last resort: fuzzy subsequence matching
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

/**
 * Check if an exercise name already exists in the canonical or custom exercise list.
 * Case-insensitive, trimmed comparison.
 */
export function isDuplicateExerciseName(
  name: string,
  canonicalExercises: Exercise[],
  customExercises: Exercise[],
  excludeId?: string,
): boolean {
  const norm = name.trim().toLowerCase();
  if (!norm) return false;
  return [...canonicalExercises, ...customExercises].some(ex => {
    if (excludeId && ex.id === excludeId) return false;
    return ex.name.trim().toLowerCase() === norm;
  });
}
