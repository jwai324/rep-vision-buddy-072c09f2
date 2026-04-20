

## Fix tutorial: allow Start Workout click + extend session flow

### Problem
1. The tutorial overlay's spotlight uses `pointer-events-auto` on the spotlight div, which **blocks clicks** on the highlighted element underneath. User can't tap "Start Workout".
2. After tapping Start Workout, the next screen is `StartWorkoutScreen` (blank/template/program picker), not directly `activeSession`. Tutorial currently jumps straight to session steps with no guidance for picking Blank Workout.
3. Session steps are sparse — only Add Exercise + Finish. Need exercise selection, weight/reps/RPE entry, completing a set.

### Fix

**1. `TutorialOverlay.tsx`** — make spotlight click-through
- Change spotlight div from `pointer-events-auto` to `pointer-events-none` so the highlighted target receives clicks normally.
- Render the dark backdrop as 4 separate divs (top/bottom/left/right of spotlight rect) each with `pointer-events-none`, so the highlighted area is fully interactive while the rest is just visually dimmed.
- Tooltip card keeps `pointer-events-auto` so Next/Back/Skip remain clickable.
- ESC + tooltip Skip button still work as dismissal paths (no need to block backdrop clicks since nothing happens on backdrop).

**2. `TutorialContext.tsx`** — add a new `startWorkout` screen between dashboard and session
- Add `'startWorkout'` to `TutorialStep['screen']` union.
- Insert a new `START_WORKOUT_STEPS` array with one step: target `tutorial-blank-workout`, title "Pick Blank Workout", body "Tap here to start an empty session — we'll add exercises next."
- Expand `SESSION_STEPS` to include:
  - `tutorial-add-exercise` — "Tap + to browse the exercise library"
  - `tutorial-set-row` — "Each row is a set. Enter your weight and reps."
  - `tutorial-rpe` — "Rate effort 1–10. Tap the ? for the scale."
  - `tutorial-complete-set` — "Tap ✓ to log the set and start your rest timer."
  - `tutorial-finish-btn` — "When done, tap Finish to save your session."
- Combined `steps` array becomes `DASHBOARD_STEPS + START_WORKOUT_STEPS + SESSION_STEPS`.

**3. Add `id` attributes**
- `StartWorkoutScreen.tsx` — `id="tutorial-blank-workout"` on the Blank Workout button.
- `ActiveSession.tsx` — `id="tutorial-set-row"` on the first set row, `id="tutorial-rpe"` on the first RPE cell, `id="tutorial-complete-set"` on the first ✓ button (add-exercise + finish ids already exist).

**4. `Index.tsx`** — wire `goToScreenSteps('startWorkout')` when the screen changes to the start-workout picker (in addition to existing `activeSession` trigger).

### Files
- Modify: `src/components/TutorialOverlay.tsx`, `src/contexts/TutorialContext.tsx`, `src/components/StartWorkoutScreen.tsx`, `src/components/ActiveSession.tsx`, `src/pages/Index.tsx`

### Validation
- Replay tutorial → reach Start Workout step → button is clickable, advances tour.
- Lands on Blank Workout step → tap Blank → tour continues into session.
- Walks through add-exercise → set row → RPE → complete set → finish.
- Skip/ESC still dismiss at any point.

