

## Plan: Add Start Date Picker for "Every N Days" Frequency

### Problem
When a user selects "Every N days" frequency for a program day, the calendar preview assumes the first occurrence starts on the program's `startDate` (today). The user has no way to pick a different first date for that specific day entry.

### Changes

**1. `src/types/workout.ts`**
- Add an optional `startDate` field to the `everyNDays` variant of `DayFrequency`:
  ```
  { type: 'everyNDays'; interval: number; startDate?: string }
  ```

**2. `src/components/ProgramBuilder.tsx`**

- **Default initialization**: When selecting `everyNDays`, initialize `startDate` to today's date (`format(new Date(), 'yyyy-MM-dd')`)
- **UI**: Below the interval selector, add a date picker (Popover + Calendar) labeled "Starting from" that lets the user pick the first occurrence date. Uses `parseLocalDate` for display and manual `yyyy-mm-dd` formatting for storage — consistent with the rest of the app.
- **Calendar preview**: Update the `everyNDays` branch in `calendarEvents` to use `freq.startDate ? parseLocalDate(freq.startDate) : startDate` as the loop origin instead of always using the program's `startDate`.
- **Draft caching**: No changes needed — `days` array (including frequency objects) is already persisted to localStorage.

### What stays the same
- Weekly and monthly frequency types — unchanged
- Program-level `startDate` — unchanged
- All date formatting uses `yyyy-MM-dd` strings and `parseLocalDate` — no UTC issues
- Future workout generation logic in `Index.tsx` (reads the same frequency data)

