

## Plan: Fix Session Date Storage to Use Local Date

### Root Cause
In `ActiveSession.tsx` line 748, workout sessions are saved with `new Date().toISOString()` which produces a **UTC** timestamp like `"2026-04-16T01:30:00.000Z"`. For users in timezones behind UTC (e.g., EDT at 9:30 PM on April 15th), the UTC date becomes April **16th**. The `parseLocalDate` utility correctly extracts the first 10 characters, but those 10 characters are the UTC date — not the local date.

Rest days don't have this problem because they use `restFw.date` which is already a clean `yyyy-MM-dd` local date.

### Fix
Store session dates as `yyyy-MM-dd` local date strings using `format(new Date(), 'yyyy-MM-dd')` from `date-fns`, consistent with how rest days and future workouts already store dates.

### Changes

**`src/components/ActiveSession.tsx`**
- Line 748: Change `new Date().toISOString()` → `format(new Date(), 'yyyy-MM-dd')`
- Lines 742-744 (edit mode): Change `.toISOString()` calls → use `editDate` directly (it's already `yyyy-MM-dd`) or `format(...)` for consistency
- Add `format` to the existing `date-fns` import

### What stays the same
- `parseLocalDate` utility — no changes needed
- All display components — already using `parseLocalDate` correctly
- Database storage — the `date` column accepts text, so `yyyy-MM-dd` works fine
- Rest day date handling — already correct

