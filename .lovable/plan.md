

The current SESSION_STEPS order after "Add Exercises" is: Pick an Exercise → Log a Set (set-row) → Weight → Reps → RPE → Complete → Finish → Discard. That looks correct, but the issue is likely that after picking an exercise and the picker closes, the next step targets `tutorial-set-row` — but if that step was already advanced past (e.g., auto-skipped via `skipIfMissing` while picker was open), the tour lands on a later step or stalls on Add Exercise again.

Looking at the flow:
- Step "Add Exercises" targets `tutorial-add-exercise` (the + button) with `skipIfMissing`.
- User taps it → picker opens → overlay stands down (picker root detected).
- "Pick an Exercise" step (no target, centered) is next — but the overlay is hidden by picker detection, so user never sees it advance.
- Tour is stuck on "Add Exercises" step the whole time the picker is open.
- User picks exercise → picker closes → overlay re-engages → still on "Add Exercises" step → spotlights the + button again, prompting user to add another.

### Fix

**`TutorialContext.tsx`** — auto-advance past Add Exercise when picker opens, and past Pick Exercise when it closes
- Add a new effect inside `TutorialProvider` that watches the DOM (MutationObserver on body) for `#tutorial-exercise-picker-root`:
  - When it **appears** AND current step targets `tutorial-add-exercise` → call `next()` (advances to "Pick an Exercise").
  - When it **disappears** AND current step is "Pick an Exercise" (no targetId, screen=activeSession, after add-exercise) → call `next()` (advances to `tutorial-set-row`).
- Use a stable check: track previous picker presence in a ref to detect open/close transitions.

This guarantees the tour progresses in lockstep with the user's actual interaction with the picker — no manual Next click required, and no re-prompting for Add Exercise.

### Files
- Modify: `src/contexts/TutorialContext.tsx`

### Validation
- Replay tutorial → reach Add Exercise spotlight → tap + → picker opens, tour silently advances → pick an exercise → picker closes → spotlight smoothly lands on the new set row → walk through Weight → Reps → RPE → Complete → Finish → Discard.

