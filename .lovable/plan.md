

## Fix: Calendar doubling after Push Program Back

### Root cause

The monthly calendar fills schedule gaps by iterating every day in the program range and calling `getProgramScheduled()` when no `future_workout` or completed session exists for that date. After pushing back:

- The `future_workouts` rows shift forward by N days (e.g., Wed → Thu).
- For `weekly` frequency, `getProgramScheduled()` still derives entries on the original weekday (Wednesday) because `f.weekday` is unchanged — shifting `startDate` does not move which Wednesdays fall in the range.
- `hasStored` is false for the original Wednesday dates (future workouts moved away), so the calendar renders BOTH the shifted future_workout AND the derived program entry.

### Fix

**`src/components/MonthlyCalendarScreen.tsx`** — skip the program-derivation loop entirely when `futureWorkouts` already exist for the active program.

If any `futureWorkouts` have `programId === activeProgram.id`, the future_workouts table is the authoritative schedule for that program. The fallback derivation from `getProgramScheduled()` should only run when NO future_workouts have been generated yet (i.e., a brand-new program before its first schedule generation).

Change the condition at line 101 from:
```ts
if (activeProgram) {
```
to:
```ts
const hasProgramFutureWorkouts = activeProgram && futureWorkouts.some(f => f.programId === activeProgram.id);
if (activeProgram && !hasProgramFutureWorkouts) {
```

This means:
- Before future_workouts are generated: calendar derives schedule from program rules (current behavior).
- After future_workouts exist (including after push-back): calendar uses only the stored future_workouts, no phantom derivation.

**`src/components/Dashboard.tsx`** — apply the same guard to the dashboard's `todayDay` logic (line 357) which indexes directly into `activeProgram.days` by weekday. After a push-back, this is also stale. Instead, check `futureWorkouts` for today's date first; only fall back to the program's `days` array when no future_workouts exist for the program.

### Files
- Modify: `src/components/MonthlyCalendarScreen.tsx`
- Modify: `src/components/Dashboard.tsx`

### Validation
- Push a program back by 1 day → calendar shows workouts only on the shifted dates, not on both old and new dates.

