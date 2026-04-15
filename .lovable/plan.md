

## Plan: Fix Rest Day Showing as Previous Day

### Root Cause
`new Date("2026-04-15")` is parsed as **UTC midnight**. For users in timezones behind UTC (all of the Americas), this renders as the previous day (April 14th). The date string `yyyy-MM-dd` is correct in storage, but every `new Date(s.date)` display call shifts it back a day.

### Fix
Replace all `new Date(s.date)` display calls with `new Date(s.date + 'T00:00:00')` to force **local time** parsing. This pattern is already used correctly in `FutureWorkoutDetail.tsx` line 33.

### Files to Change

**1. `src/components/WorkoutHistory.tsx`** (line 67)
- `new Date(s.date)` → `new Date(s.date + 'T00:00:00')`

**2. `src/components/ActivityScreen.tsx`** (lines 34, 161)
- Both `new Date(s.date)` → `new Date(s.date + 'T00:00:00')`

**3. `src/components/Dashboard.tsx`** (lines 38, 263)
- Both `new Date(s.date)` → `new Date(s.date + 'T00:00:00')`

**4. `src/components/ExerciseDetailModal.tsx`** (line 25)
- `new Date(s.date)` → `new Date(s.date + 'T00:00:00')`

**5. `src/components/ProgramBuilder.tsx`** (line 221)
- `new Date(s.date)` → `new Date(s.date + 'T00:00:00')`

### What stays the same
- All storage/save logic (dates are stored correctly as `yyyy-MM-dd`)
- The `format()` calls that already receive correct Date objects
- No database changes

