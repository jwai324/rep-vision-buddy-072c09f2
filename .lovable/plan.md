

## Fix: Push Program Back should update the program schedule too

### Problem
When pushing a program back by N days, only the `future_workouts` table rows get their dates shifted. The program itself (`workout_programs.start_date` and each `days[].frequency.startDate`) stays unchanged. This causes:
1. The monthly calendar re-derives schedule from the old program dates for any gaps, showing phantom entries at the original dates.
2. If the program is ever re-saved or future workouts regenerated, the old unshifted dates are used.

### Fix

**`src/hooks/useStorage.ts`** — in the `pushProgramBack` callback, after shifting future_workouts, also update the program:

1. Find the program by `programId` from the local `programs` state.
2. Shift `program.startDate` forward by `days` days.
3. Shift each `day.frequency.startDate` (for `everyNDays` type) forward by `days` days.
4. Save the updated program to the DB via `supabase.from('workout_programs').update(...)`.
5. Update the local `programs` state with the shifted program.

This ensures the calendar's `getProgramScheduled()` fallback and any future regeneration use the correct shifted dates.

### Files
- Modify: `src/hooks/useStorage.ts`

### Validation
- Push program back by 1 day -> program's `startDate` and frequency `startDate` values shift by 1 day -> calendar no longer shows phantom entries at old dates.

