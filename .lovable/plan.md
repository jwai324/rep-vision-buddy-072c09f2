## Persist exercise picker selections across navigation

### Problem
When the user opens the exercise picker during a workout, selects exercises, then navigates away (e.g. via the minimized session bar), the ActiveSession component unmounts. On return, `showExercisePicker` resets to `false` and the ExerciseSelector's internal `selected` state is lost.

### Fix

1. **Cache `showExercisePicker` and selected exercise IDs** in the `ActiveSessionCache` interface and the `safeWriteCache` call, so they survive unmount/remount.

2. **Lift `selected` state** into `ActiveSession.tsx` — initialize from cache, pass into `ExerciseSelector` as a new prop.

3. **Update `ExerciseSelector`** to accept optional `initialSelected` and `onSelectionChange` props so the parent controls persistence.

### Files
- **`src/components/ActiveSession.tsx`**
  - Add `showExercisePicker?: boolean` and `pendingExerciseIds?: ExerciseId[]` to `ActiveSessionCache`
  - Initialize `showExercisePicker` from cache
  - Manage a `pendingExerciseIds` state, pass to ExerciseSelector and include in cache writes
- **`src/components/ExerciseSelector.tsx`**
  - Add `initialSelected?: ExerciseId[]` and `onSelectionChange?: (ids: ExerciseId[]) => void` props
  - Initialize `selected` from `initialSelected`; call `onSelectionChange` when selection changes
