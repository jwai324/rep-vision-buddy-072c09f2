

## Plan: Show and Edit Recovery Activities for Saved Rest Days

### Problem
When clicking a saved rest day in the Activity history, `SessionSummary` shows generic workout stats (0 sets, 0 reps, etc.) with no recovery activities displayed and no way to edit them.

### Solution
Add rest-day-aware rendering to `SessionSummary` and an `onUpdateSession` callback to allow editing recovery activities in-place.

### Changes

**1. `src/components/SessionSummary.tsx`**
- Detect `session.isRestDay` and render a rest-day-specific view instead of the workout stats/exercise breakdown:
  - Rest day header (🛏️ icon, "Rest Day" title, date)
  - Recovery activities list with checkboxes (same UI as `FutureWorkoutDetail`)
  - "Add Recovery Exercise" button with the same exercise picker (search + `REST_DAY_EXERCISES` list)
- Add `onUpdateSession?: (session: WorkoutSession) => void` prop for persisting activity changes
- Keep the Delete button for rest day sessions in view mode

**2. `src/pages/Index.tsx`**
- Pass `onUpdateSession` to `SessionSummary` when in `sessionDetail` view, calling `storage.saveSession` to persist changes

### What stays the same
- Non-rest-day workout viewing is unchanged
- The `FutureWorkoutDetail` rest day UI (for future/scheduled rest days)
- Database schema — `workout_sessions` already has `recovery_activities` and `is_rest_day` columns

