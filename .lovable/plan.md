

## Plan: Fix Calendar Off-By-One Date Bug

### Problem
Workout session dates are stored as UTC ISO strings (e.g., `2026-04-14T01:48:00.000Z`). The dashboard calendar compares them with `s.date.startsWith(dayStr)` where `dayStr` is a local date string. For users behind UTC (like US timezones), a workout logged in the evening appears on the next day in the calendar.

### Fix
In `src/components/Dashboard.tsx`, line 261, change the comparison to convert the session's UTC date to a local date string before comparing:

```ts
// Before (broken):
const completedSessions = history.filter(s => s.date.startsWith(dayStr));

// After (fixed):
const completedSessions = history.filter(s => {
  const sessionDate = format(new Date(s.date), 'yyyy-MM-dd');
  return sessionDate === dayStr;
});
```

The same pattern is already used correctly in the `getStreak` function and `WeeklySetsByBodyPart` component (lines 37 and 91), which handle both ISO and pre-formatted date strings. We should apply the same approach here.

### What changes
- **`src/components/Dashboard.tsx`** line 261 -- convert session UTC date to local date string before comparison

### What stays the same
- All other date handling, streak calculation, weekly sets logic

