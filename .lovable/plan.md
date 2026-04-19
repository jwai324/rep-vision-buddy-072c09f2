

## Missed workout management

Add "Missed" badge + cleanup actions for past-due scheduled workouts.

### Detection
A future workout is "missed" when `parseLocalDate(fw.date) < today` AND it still exists (not completed/saved). Compute via `formatLocalDate(new Date())` comparison.

### UI changes

**1. `FutureWorkoutsScreen.tsx`** — list item
- Show red "Missed" badge next to label when past-due.
- Sort missed items to the top in their own "Missed" section header.

**2. `FutureWorkoutDetail.tsx`** — when opened on a missed workout, show an action panel above the existing Perform/Save buttons with three buttons:
- **Reschedule** → opens existing date picker (already present); user picks new date, taps Save (new "Save Changes" button persists the date change for non-rest workouts too).
- **Skip workout** → confirms, then deletes this single `future_workout` row.
- **Push program back by X days** → numeric input (default 1) + confirm. Shifts the date of THIS workout and every later `future_workout` belonging to the same `program_id` forward by X days.

### Data layer

**`src/hooks/useStorage.ts`** — add three handlers exposed via the storage hook:
- `updateFutureWorkoutDate(id, newDate)` — UPDATE single row's `date`.
- `deleteFutureWorkout(id)` — DELETE single row (already partially exists via save flow; expose explicit version).
- `pushProgramBack(programId, fromDate, days)` — SELECT all `future_workouts` where `program_id = programId AND date >= fromDate`, then UPDATE each row's date forward by `days` (computed client-side with `parseLocalDate` + `formatLocalDate` to stay timezone-safe).

### Wiring
- `Index.tsx` passes the three handlers down to `FutureWorkoutDetail`.
- `FutureWorkoutDetail` receives `isMissed` flag (computed in parent or inline) and renders the action panel only when true.
- Existing rest-day date picker logic is reused; for non-rest workouts the date picker becomes available too when missed.

### Files
- Modify: `src/components/FutureWorkoutsScreen.tsx`, `src/components/FutureWorkoutDetail.tsx`, `src/hooks/useStorage.ts`, `src/pages/Index.tsx`

### Unchanged
- DB schema (uses existing `future_workouts.date` column), RLS, types, save/perform flows.

### Validation
- Schedule a workout for yesterday → Future Workouts list shows red "Missed" badge under a "Missed" section.
- Open it → see Reschedule / Skip / Push back actions.
- Reschedule to tomorrow → row updates, badge disappears.
- Skip → row deletes, returns to list.
- Push back by 2 days on a program workout → this and all later same-program workouts shift +2 days.

