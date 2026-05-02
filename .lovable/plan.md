## What changes

In the Focus Mode "Up next" footer, show the next exercise's upcoming set weight and reps alongside the exercise name (e.g. "Bench Press — 80kg × 8").

## Technical details

**File: `src/components/FocusMode.tsx`**

1. Refactor `computeNextName` into `computeNextInfo` that returns `{ name, weight, reps } | null` instead of just a string. It will:
   - Find the next block index (same as today)
   - Find the first incomplete set in that block
   - Return the set's weight and reps values along with the exercise name

2. Update the `nextExerciseName` memo to use the new function, getting back an object.

3. In the "Up next" footer UI, append weight/reps after the exercise name when available, e.g.:
   ```
   Up next
   Bench Press · 80kg × 8
   ```
   Weight will be displayed with the user's weight unit. If weight or reps are empty/zero, only show what's available.
