

## Plan: Offer to update template after edited workout

### Goal
When a user starts a workout from a template, edits the structure during the active session (adds/removes/swaps exercises, changes set count or target reps), and then completes it — prompt them to push those changes back to the source template.

### Exploration needed (assumed from project structure)
- `ActiveSession.tsx` already tracks the originating template (templates launch sessions there) and handles "Finish workout".
- `WorkoutSession` type likely carries a `templateId` (or similar) when launched from a template.
- Templates are stored via the existing template store / Supabase table used by `TemplateBuilder` / `TemplatesScreen`.

### Approach

**1. Snapshot template structure at session start**
When a session is launched from a template, capture a lightweight signature of the template's structure:
- For each exercise: `exerciseId`, `sets.length`, `targetReps`, `setType`.
Store on the active session state (in-memory + localStorage cache, alongside `templateId`).

**2. Compare on finish**
In the finish-workout flow in `ActiveSession.tsx`, compare the snapshot to the final session blocks. Detect a meaningful diff if any of:
- Exercise added or removed
- Exercise swapped (different `exerciseId` at same position)
- Set count changed for an existing exercise
- `targetReps` changed (use last completed set's reps as the new target)
- Superset grouping changed

Ignore weight/RPE/actual-reps differences — those are normal per-session variation, not template edits.

**3. Prompt user**
If a diff is detected AND `templateId` exists AND the template still exists:
- After saving the session, show an `AlertDialog`: 
  - Title: "Update template?"
  - Body: "Your workout differs from **{template name}**. Update the template to match what you just did?"
  - Summary line: e.g. "+1 exercise, 2 set count changes"
  - Buttons: "Keep template" / "Update template"
- On "Update template": rebuild the template's exercise list from the completed session blocks (preserving `exerciseId`, set count, last-used reps as `targetReps`, set types, superset groups, existing `restSeconds`) and save via the existing template update path.

**4. Edge cases**
- Don't prompt for ad-hoc workouts (no `templateId`).
- Don't prompt if the template was deleted mid-session — silently skip.
- Don't prompt if no structural diff.
- Show prompt once, after the session summary save completes, before navigating away.

### Files to touch
- `src/components/ActiveSession.tsx` — snapshot on mount-from-template, diff on finish, render confirmation dialog, call template update.
- `src/types/workout.ts` — add optional `templateSnapshot` field to in-memory session state (not persisted to DB).
- Possibly a small helper `src/utils/templateDiff.ts` — pure function to compute the structural diff + human-readable summary.

### What stays the same
- Template schema, save path, and `TemplateBuilder` UI.
- Session save flow and `SessionSummary`.
- Behavior for non-template workouts.

