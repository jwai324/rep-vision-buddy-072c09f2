

## Plan: Forgiving Exercise Search with Fuzzy Matching

### Problem
Searching "pull ups" fails to find "Pull-Ups" because the current filter uses exact `string.includes()` matching. Hyphens, special characters, and typos break discovery.

### Solution: Normalized matching + lightweight fuzzy scoring

Two layers applied in sequence:

1. **Normalize & tokenize** — strip all non-alphanumeric characters from both query and exercise fields, split into words, require all words to appear in the combined target string. This handles "pull ups" → "Pull-Ups" and "t bar" → "T-Bar Row".

2. **Fuzzy fallback** — if the normalized match returns zero results, fall back to fuzzy substring matching using a simple character-by-character containment check (no new dependencies). This catches minor typos like "pulups" or "benchpress".

### Changes

**`src/components/ExerciseSelector.tsx`** (~15 lines changed in the `filtered` useMemo)

- Add a `normalize` helper: strips non-alphanumeric (except spaces), lowercases
- Add a `fuzzyIncludes(target, query)` helper: checks if all characters of query appear in order within target (subsequence match)
- Update `matchesSearch` logic:
  - Primary: split normalized search into words, check all words appear in normalized `name + bodyPart + equipment`
  - Fallback: if primary yields 0 results, re-filter using `fuzzyIncludes` against the same normalized target
- No new dependencies required

**Examples that would work:**
- "pull ups" → Pull-Ups ✓
- "tbar" → T-Bar Row ✓  
- "pulups" → Pull-Ups ✓ (fuzzy fallback)
- "lat pull" → Lat Pull-Down ✓
- "dmbell curl" → Dumbbell Curl ✓ (fuzzy fallback)

