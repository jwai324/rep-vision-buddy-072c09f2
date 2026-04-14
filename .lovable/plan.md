

## Plan: Add Workout Note (3-Dot Menu in Active Session)

### What it does
Adds a three-dot menu to the active workout header with an "Add Note" option. The note persists with the saved session, is visible in the Workout Detail view, and can be edited when re-editing a session.

### Changes

**1. `src/types/workout.ts`** — Add `note?: string` to the `WorkoutSession` interface (around line 27).

**2. `src/components/ActiveSession.tsx`**
- Add state: `const [workoutNote, setWorkoutNote] = useState(editSession?.note ?? '')` and `const [showNoteDialog, setShowNoteDialog] = useState(false)`
- Add the note to the session cache (`ActiveSessionCache` interface + cache write)
- Restore note from cache: `cachedSession?.workoutNote ?? ''`
- In `finishWorkout`, include `note: workoutNote || undefined` in the session object
- In the header (between the back arrow and the Discard/Finish buttons), add a `DropdownMenu` with a `MoreVertical` trigger containing "Add/Edit Note"
- Add a dialog/modal for editing the note text

**3. `src/components/SessionSummary.tsx`** — Display the note (if present) below the stats grid and above the exercise breakdown. When in view mode, show the note as read-only text. Include an "Edit Note" option if `onEdit` is available.

**4. `src/hooks/useStorage.ts`** — Include `note` in the `saveSession` upsert call and in the data mapping when loading sessions.

**5. Database migration** — Add a `note` text column (nullable) to the `workout_sessions` table:
```sql
ALTER TABLE public.workout_sessions ADD COLUMN note text;
```

### What stays the same
- Exercise-level notes (session notes and sticky notes) are unchanged
- All other session data, RLS policies, and components remain untouched

