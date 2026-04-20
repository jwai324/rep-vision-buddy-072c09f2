

The Finish/Discard tutorial steps target buttons in the session header (`tutorial-finish-workout`, `tutorial-discard-workout`), but those buttons live at the **bottom** of `SessionSummary` after tapping Finish — not the top header. Looking at SessionSummary.tsx, the actual save/discard buttons are at the bottom action area (lines ~395-425) and don't carry tutorial IDs at all. The header "Finish" button only opens the summary; the real "Save Workout" / "Discard" actions are on the summary screen.

### Fix

**`src/components/SessionSummary.tsx`** — add tutorial IDs to the actual Save/Discard buttons
- Add `id="tutorial-save-workout"` to the "Save Workout" `<Button variant="neon" onClick={onSave}>`.
- Add `id="tutorial-discard-workout"` to the "Discard" `<button onClick={() => setShowDiscardConfirm(true)}>`.

**`src/contexts/TutorialContext.tsx`** — update SESSION_STEPS
- Rename/retarget the "Finish" step → target `tutorial-finish-workout` (header button, opens summary), title "Finish Workout", description "Tap Finish to review your workout."
- Add a new step after Finish → target `tutorial-save-workout`, title "Save Your Workout", description "Save your completed session here.", screen `activeSession`, `skipIfMissing: true`.
- Update "Discard" step → target `tutorial-discard-workout` (now on summary screen), description updated to point at the bottom discard link, `skipIfMissing: true`.

The MutationObserver already handles re-measure when the summary mounts, so the spotlight will smoothly transition from the header Finish button to the summary's Save/Discard buttons.

### Files
- Modify: `src/components/SessionSummary.tsx`, `src/contexts/TutorialContext.tsx`

### Validation
At 384px: tutorial reaches Finish → spotlight on header Finish button → tap → summary opens → spotlight lands on bottom "Save Workout" button → next → spotlight lands on bottom "Discard" link → tour completes.

