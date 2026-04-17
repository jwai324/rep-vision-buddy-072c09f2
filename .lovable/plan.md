

## Refine Focus Mode header

### Changes

**`src/components/ActiveSession.tsx`**
- Add optional prop `hideHeaderName?: boolean` to `ExerciseTable`.
- When `true`, hide the exercise-name button at line ~2132–2135 (keep the action icons row intact).

**`src/components/FocusMode.tsx`**
1. **Enlarge the exercise name** in the FocusMode header (line ~177): bump from `text-2xl` to `text-3xl sm:text-4xl`, keep meta line below.
2. **Pass `hideHeaderName`** to the embedded `<ExerciseTable />` so the duplicate name is removed.
3. **Compute `nextExerciseName`**: build a synthetic `blocks` array where the currently focused block's sets and all drops are marked `completed: true`, run `pickFocusedBlockIdx` on it, and read that block's `exerciseName`. If `null` → "Last exercise" (or hide the footer).
4. **Add a "Next" footer** at the bottom of the FocusMode scroll area (above `pb-24` padding), styled subtly:
   ```
   Up next
   {nextExerciseName}
   ```
   Small uppercase label + medium-weight name in muted-foreground. Hidden when no next exercise.

### Files
- Modify: `src/components/ActiveSession.tsx` (add `hideHeaderName` prop)
- Modify: `src/components/FocusMode.tsx` (larger title, pass prop, render next-up footer)

### Unchanged
- All set-logging, transition, scroll, timer, superset logic.

