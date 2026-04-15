

## Plan: Add Date Picker to Rest Day Creation and Editing

### Problem
When adding a rest day, the date is hardcoded to today with no way to change it. When viewing a saved rest day in SessionSummary, there is no way to edit the date.

### Changes

**1. `src/components/FutureWorkoutDetail.tsx`**
- Add local `date` state initialized from `futureWorkout.date`
- Add a date picker (Popover + Calendar from shadcn) below the header, allowing the user to pick any date
- Pass the updated date through to `onSaveRestDay` so the saved session uses the selected date

**2. `src/components/SessionSummary.tsx`**
- In the rest-day view (`session.isRestDay && isViewMode`), add a date picker below the header
- When date changes, call `onUpdateSession` with the updated date string (formatted as `yyyy-MM-dd`)
- Use `parseLocalDate` for display consistency

**3. No changes to `src/pages/Index.tsx`**
- The `onSaveRestDay` callback already reads `restFw.date`, so it will automatically use whatever date the user picked
- The `onUpdateSession` callback already persists the full session

### Technical details
- Uses existing `Calendar` and `Popover` components (shadcn)
- Date stored as `yyyy-MM-dd` string — consistent with existing date conventions
- `parseLocalDate` used for display to avoid UTC offset issues
- Add `pointer-events-auto` class to Calendar per shadcn datepicker guidelines
- Import `format` from `date-fns` (already a project dependency)

