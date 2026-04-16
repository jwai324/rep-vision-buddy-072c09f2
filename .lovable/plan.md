
## Copy Full Previous Set Data on Tap

### Current behavior
Tapping the "Previous" cell in an active session set row only copies `weight` and `reps` from the most recent matching session.

### Change
Also copy `rpe` and `time` so the whole set is mirrored.

### Files

**`src/components/ActiveSession.tsx`**

1. **Extend `getPreviousExerciseData` (line 96)** to return `rpe` and `time` in addition to `weight` and `reps`:
   ```ts
   { weight?: number; reps: number; rpe?: number; time?: number }[]
   ```
   Map from `s.weight, s.reps, s.rpe, s.time`.

2. **Update `previousSets` prop type (line 1289)** to match the new shape.

3. **Update the tap handler (lines 1514–1518)** so after copying weight/reps it also copies:
   - `rpe` → `String(prev.rpe)` if defined
   - `time` → `String(prev.time)` if defined (used for cardio mode, stored in the `time` field of `SetRow`)

   Keep using `onUpdateSet` for each field. Skip fields that are `undefined` so we don't wipe existing data with empty strings.

4. **Cardio mode caveat**: in cardio mode the visible "reps" cell actually displays time. The previous data's `time` is what should populate the time field; `reps` is unused. The handler will copy whichever fields exist on the previous set, which handles both modes correctly.

### What stays the same
- The displayed text in the Previous cell (still `weight × reps`) — RPE/time aren't shown there, only copied on tap.
- All other set/cascade logic untouched.
