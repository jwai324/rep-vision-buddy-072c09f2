

The "Finish Workout" step targets the header `tutorial-finish-btn`. When tapped, the SessionSummary mounts and `tutorial-save-workout` appears in the DOM, but the tour stays on the Finish step until the user clicks Next.

### Fix
**`src/contexts/TutorialContext.tsx`** — extend the existing MutationObserver effect to auto-advance when the summary appears.
- When current step's `targetId === 'tutorial-finish-btn'` AND `document.getElementById('tutorial-save-workout')` exists → call `setIndex(i+1)` to advance to "Save Your Workout".
- Also handle the next transition: when current step targets `tutorial-save-workout` and that element disappears (summary closed without saving — edge case), no action needed; user moves manually.

This mirrors the existing picker-open auto-advance pattern, requires no new IDs, and keeps the tour in sync with the user's tap on Finish.

### Files
- Modify: `src/contexts/TutorialContext.tsx`

### Validation
At 384px: reach Finish step → tap Finish → summary opens → tour auto-advances and spotlight lands on bottom "Save Workout" button without manual Next.

