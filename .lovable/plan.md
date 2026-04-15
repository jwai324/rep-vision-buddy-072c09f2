

## Plan: Fix Date Display Inconsistency Between Activity Screen and Session Details

### Root Cause
The database contains dates stored as full UTC timestamps (e.g., `"2026-04-14T01:48:00.000Z"`). The `SessionSummary` component uses `new Date(session.date)` which correctly converts UTC to local time. But `ActivityScreen`, `WorkoutHistory`, and other list views use `parseLocalDate()` which extracts the first 10 characters of the UTC string — giving the UTC calendar date, not the local one.

For example, a workout done at 9:48 PM EDT on April 13th is stored as `2026-04-14T01:48:00.000Z`. `SessionSummary` shows April 13 (correct), but `parseLocalDate` extracts `2026-04-14` and shows April 14 (wrong).

### Fix
Update `parseLocalDate` to handle full ISO timestamps by converting them to a local Date first, then extracting the local date components. This fixes all consumers at once.

### Changes

**1. `src/utils/dateUtils.ts`**
Update `parseLocalDate` logic:
- If the string is exactly 10 characters (`yyyy-MM-dd`), keep current behavior (append `T00:00:00`)
- If it's a full ISO timestamp, parse it with `new Date()` (which gives correct local time), then construct a midnight Date from the local year/month/day

**2. `src/components/SessionSummary.tsx`** (lines 78, 84)
- Replace `new Date(session.date)` with `parseLocalDate(session.date)` for consistency

### Technical detail
```typescript
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.length === 10) {
    return new Date(dateStr + 'T00:00:00');
  }
  // Full ISO timestamp — parse natively to get local time, then extract local date
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
```

