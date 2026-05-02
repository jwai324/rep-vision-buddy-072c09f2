## Problem

Workout start time is not persisted. The `date` column only stores `yyyy-MM-dd`. The edit mode has a "Time" input but it's not wired to anything on save. New workouts don't record when they began.

## Plan

### 1. Database migration — add `started_at` column

Add a nullable `timestamptz` column to `workout_sessions`:

```sql
ALTER TABLE public.workout_sessions ADD COLUMN started_at timestamptz;
```

### 2. Update WorkoutSession type

**`src/types/workout.ts`** — add `startedAt?: string` to the `WorkoutSession` interface.

### 3. Save start time on new workouts

**`src/components/ActiveSession.tsx`** — in `finishWorkout`:
- For new workouts: set `startedAt` to `new Date(startTime.current).toISOString()` (the ref already tracks when the session began).
- For edit mode: combine `editDate` + `editTime` into a `startedAt` ISO string so the "Time" input actually persists.

### 4. Persist and load `started_at`

**`src/hooks/useStorage.ts`**:
- `saveSession`: include `started_at: session.startedAt ?? null` in the upsert.
- `mapSession`: read `row.started_at` into `startedAt`.

### 5. Show start time on completed sessions

**`src/components/SessionSummary.tsx`** — display the start time (e.g. "Started at 6:45 AM") below the date when `session.startedAt` is available.

### 6. Wire start time into edit mode

**`src/components/ActiveSession.tsx`** — initialize `editTime` from `editSession.startedAt` (if present) instead of parsing the date-only string. This way the existing "Time" input correctly shows and edits the start time.
