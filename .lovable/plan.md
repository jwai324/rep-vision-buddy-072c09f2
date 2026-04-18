
The "Today's workout" preview on the Dashboard renders exercise names via `EXERCISES[e.exerciseId]?.name`, which only contains built-in exercises. Custom exercises (IDs prefixed `custom-`) aren't in that map, so they fall back to the raw ID.

There's already a `useExerciseLookup()` hook that merges built-in + custom exercises into one `id → name` map. I'll use it.

### Plan
1. In `src/components/Dashboard.tsx`, import `useExerciseLookup` and replace `EXERCISES[e.exerciseId]?.name` in the "Today's workout" section with `lookup[e.exerciseId] ?? 'Exercise'`.
2. Audit other places that show today's preview the same way and fix them too for consistency:
   - `src/components/StartWorkoutScreen.tsx` — both the active program "Today's Workout" line and the templates list use `EXERCISES[e.exerciseId]?.name`. Apply the same lookup fix.

### Files
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/StartWorkoutScreen.tsx`

### Unchanged
- `EXERCISES` map, `useExerciseLookup`, `CustomExercisesContext`, data layer.
