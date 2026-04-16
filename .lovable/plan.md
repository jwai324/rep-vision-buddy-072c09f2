
## Add Exercise Detail Tap in Active Session

### Goal
In an active workout, tapping an exercise's name/header should open the existing `ExerciseDetailModal` (info, history, volume) for that exercise.

### Approach
Reuse the existing `ExerciseDetailModal` component (already used by `BrowseExercisesScreen`) inside `ActiveSession.tsx`.

### Changes

**`src/components/ActiveSession.tsx`**
- Import `ExerciseDetailModal`.
- Add local state: `const [detailExerciseId, setDetailExerciseId] = useState<ExerciseId | null>(null)`.
- Make the exercise name/header in each exercise block tappable (button) — on click, set `detailExerciseId` to that block's `exerciseId`.
  - Stop propagation so it doesn't conflict with existing controls (drag handle, swap, delete, superset linker, note, etc.).
  - Only trigger on the name area, not the whole card, to avoid interfering with set inputs.
- Render `<ExerciseDetailModal exerciseId={detailExerciseId} onClose={() => setDetailExerciseId(null)} history={history} weightUnit={weightUnit} />` near the bottom of the component.
- Pass `history` prop through (already available in ActiveSession via props from Index).

**Verification**
- `ExerciseDetailModal` already handles `null` exerciseId (returns null) and is self-contained.
- `history` and `weightUnit` are already props on `ActiveSession`.

### What stays the same
- `ExerciseDetailModal` itself — no changes.
- All existing session interactions (set entry, swipe-to-delete, rest timer, swap, etc.) remain untouched.
- Custom exercises not in `EXERCISE_DATABASE` will simply not open the modal (modal returns null) — acceptable; can be addressed later if needed.
