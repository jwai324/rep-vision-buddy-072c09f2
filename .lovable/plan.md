## Problem

`getPreviousExerciseData` (line 144) returns **all** sets from the last session, including warmup sets. But in `ExerciseTable`, the "Previous" column indexes this array using `workingSetIndex` — which counts only non-warmup sets. This causes a mismatch: current Set 1 shows the previous session's warmup data instead of Set 1's data.

## Fix

**`src/components/ActiveSession.tsx`** — Filter out warmup sets in `getPreviousExerciseData`:

```ts
function getPreviousExerciseData(...) {
  ...
  return log.sets
    .filter(s => s.type !== 'warmup')
    .map(s => ({ weight: s.weight, reps: s.reps, rpe: s.rpe, time: s.time }));
}
```

This single-line change ensures the previous-sets array only contains working sets, which is what `workingSetIndex` expects.
