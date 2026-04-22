

## Fix: Dashboard calendar emojis still use stale program-derived events

### Problem
The `WeeklyProgramCalendar` in `Dashboard.tsx` still calls `buildProgramEvents(program)` and uses `day.events` (lines 273-274) to determine emojis/background — even when `futureWorkouts` already exist for the program. This causes the old (pre-push) schedule to show workout/rest emojis on the wrong days.

### Fix

**`src/components/Dashboard.tsx`** — skip program event derivation when future workouts exist for the active program (same pattern applied to the monthly calendar):

1. In `WeeklyProgramCalendar`, compute `hasProgramFutureWorkouts` from the `futureWorkouts` prop.
2. Change the `events` memo (line 210) to return an empty array when `hasProgramFutureWorkouts` is true:
   ```ts
   const hasProgramFutureWorkouts = program && futureWorkouts.some(f => f.programId === program.id);
   const events = useMemo(() => (program && !hasProgramFutureWorkouts) ? buildProgramEvents(program) : [], [program, hasProgramFutureWorkouts]);
   ```
3. This makes `day.events` empty when future workouts exist, so the icon/background logic at lines 273-291 falls through to the `futureWorkouts`-based checks (`hasScheduledWorkout`, `hasScheduledRest`) which already use the correct shifted dates.

### Files
- Modify: `src/components/Dashboard.tsx`

### Validation
- Push program back by 1 day. Dashboard weekly calendar shows emojis only on the shifted dates, not on both old and new dates.

