

## Plan: Show Superset Colors in Workout Detail View

### Problem
When viewing a completed workout, exercises that were supersetted together during the session all appear with the same plain `bg-card` background. The superset grouping information is lost because `supersetGroup` is not saved to the `ExerciseLog` type or persisted when the workout finishes.

### Changes

**1. `src/types/workout.ts`** — Add `supersetGroup?: number` to the `ExerciseLog` interface.

**2. `src/components/ActiveSession.tsx`** (~line 688) — Include `supersetGroup` when building `exerciseLogs` in `finishWorkout`:
```ts
.map(b => ({
  exerciseId: b.exerciseId,
  exerciseName: b.exerciseName,
  supersetGroup: b.supersetGroup,
  sets: b.sets.filter(s => s.completed).map(s => ({ ... })),
}));
```

**3. `src/components/SessionSummary.tsx`** (~line 82) — Apply the same superset background colors used in `ActiveSession`:
- Add a local `SUPERSET_COLORS` array (same as in ActiveSession)
- Add a `getSupersetColorClass` helper
- Apply the color class to each exercise card based on `ex.supersetGroup`

```tsx
const SUPERSET_COLORS = [
  'bg-red-500/20', 'bg-blue-500/20', 'bg-green-500/20',
  'bg-yellow-500/20', 'bg-pink-500/20', 'bg-orange-500/20',
  'bg-amber-800/20', 'bg-purple-500/20', 'bg-white/20',
];

const getSupersetColorClass = (group?: number) => {
  if (group === undefined) return '';
  return SUPERSET_COLORS[(group - 1) % SUPERSET_COLORS.length];
};

// In the exercise breakdown:
<div key={i} className={`rounded-xl p-4 border border-border ${
  ex.supersetGroup !== undefined
    ? getSupersetColorClass(ex.supersetGroup)
    : 'bg-card'
}`}>
```

### What stays the same
- All other components, the SupersetLinker, and ActiveSession coloring logic remain untouched
- Existing saved workouts without `supersetGroup` will render normally (field is optional)

