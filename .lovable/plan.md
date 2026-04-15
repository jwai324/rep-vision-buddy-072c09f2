

## Fix: Align ConsistencyTab Streaks with Dashboard

### Root cause
The dashboard's `getStreak()` includes all session types (workouts + rest days) and skips today if empty. The `ConsistencyTab` excludes rest days from its date map and breaks immediately if today has no session, producing different streak values.

### Changes

**`src/components/analytics/ConsistencyTab.tsx`**
- Change the `volumeMap` loop to also track rest days in a separate `workoutDates` set (matching dashboard logic: any session = active day)
- Use `workoutDates` for streak calculations instead of `volumeMap`
- Add the "skip today if empty" logic: if today has no session, start checking from yesterday (matching dashboard's `else if (i > 0) break; else continue;` pattern)
- Keep `volumeMap` (non-rest-day volume) for the heatmap grid rendering — only streak math changes

### What stays the same
- Dashboard `getStreak()` — untouched, it's the source of truth
- Heatmap grid still shows volume intensity (rest days show as empty cells)
- Longest streak calculation uses the same `workoutDates` set

