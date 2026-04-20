

## Hide tutorial overlay during exercise picking

### Problem
`ExerciseSelector` is rendered as a full-screen view (not a Radix dialog), so the modal-blocking detection misses it. The overlay either misaligns or shows a centered tooltip with a full-screen dim that covers the exercise list, making it hard to see/select an exercise.

### Fix

**1. `TutorialOverlay.tsx`** — detect the exercise picker and stand down completely
- Add a check for `document.getElementById('tutorial-blank-workout')`-style picker root, or simpler: look for the ExerciseSelector's stable container.
- Cleanest signal: add `id="tutorial-exercise-picker-root"` to the wrapper div in `ActiveSession.tsx` line 1425.
- In the overlay's `measure()`, if that element exists AND the current step's `targetId` is not inside it, render **nothing** (no backdrop, no tooltip) — fully step aside.
- Existing MutationObserver already triggers re-evaluation, so when the picker closes the next step (`tutorial-set-row`) re-engages automatically.

**2. `ActiveSession.tsx`** — add the picker root id
- Line 1425: `<div id="tutorial-exercise-picker-root" className="h-[100dvh] ...">`

### Files
- Modify: `src/components/TutorialOverlay.tsx`, `src/components/ActiveSession.tsx`

### Validation
- Replay tutorial → tap Add Exercise → picker opens with **no** tutorial overlay or dimming, full exercise list visible/scrollable → pick exercise → picker closes → tutorial spotlight resumes on the new set row → continues through weight/reps/RPE/complete/finish/discard.

