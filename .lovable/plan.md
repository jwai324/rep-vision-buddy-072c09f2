

## Plan: Fix Activity Screen Date Filtering Bug

### Problem
Same UTC/local timezone mismatch as the calendar bug. In `src/components/ActivityScreen.tsx` line 31, history is filtered with `s.date.startsWith(filterDate)` where `filterDate` is a local date string (e.g., `2026-04-13`) but `s.date` can be a UTC ISO string (e.g., `2026-04-14T01:48:00.000Z`). This causes workouts to not appear on the correct day.

### Fix
In `src/components/ActivityScreen.tsx`, line 31, apply the same local-date conversion used elsewhere:

```ts
// Before:
if (filterDate) items = items.filter(s => s.date.startsWith(filterDate));

// After:
if (filterDate) items = items.filter(s => {
  const sessionDate = s.date.length >= 10 ? format(new Date(s.date), 'yyyy-MM-dd') : s.date;
  return sessionDate === filterDate;
});
```

This requires importing `format` from `date-fns` (already imported in the file — needs to be verified and added if missing).

### What changes
- **`src/components/ActivityScreen.tsx`** line 31 — convert session date to local string before comparing with `filterDate`

### What stays the same
- Future workouts filtering (line 37) — already uses `f.date === filterDate` which is correct since future workout dates are stored as plain date strings
- All other components

