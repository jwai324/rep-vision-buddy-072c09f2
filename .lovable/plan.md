

## Plan: Fix Superset Colors in Workout Detail View

### Problem
Existing saved workouts don't have `supersetGroup` in their exercise JSON because they were logged before the persistence fix. The `SessionSummary` component only colors exercises when `supersetGroup` is present, so all exercises show plain `bg-card`.

However, exercises that were supersetted have `type: "superset"` on their sets. We can use this to infer grouping for older data.

### Fix

**`src/components/SessionSummary.tsx`** — Add a fallback that infers superset groups from set types when `supersetGroup` is missing:

Before rendering, scan the exercises array. If no exercise has `supersetGroup` but some have sets with `type === 'superset'`, assign consecutive superset-typed exercises the same group number:

```ts
// Infer superset groups for legacy data
const exercisesWithGroups = session.exercises.map(ex => {
  if (ex.supersetGroup !== undefined) return ex;
  const hasSuperset = ex.sets.some(s => s.type === 'superset');
  return hasSuperset ? { ...ex, _inferredSuperset: true } : ex;
});
```

More precisely: if no exercises already have `supersetGroup`, group all exercises whose sets are typed `"superset"` into a single group (group 1). This matches the existing behavior where superset-typed exercises are visually linked.

### What changes
- **`src/components/SessionSummary.tsx`** — Add pre-processing logic to infer `supersetGroup` from set types for backward compatibility

### What stays the same
- New workouts will continue to save `supersetGroup` correctly
- All other components and data flow remain untouched

