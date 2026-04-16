
## Fix Wrong Date When Editing a Workout

### Root cause
In `src/components/ActiveSession.tsx` (lines 260-269), edit mode initializes the date/time pickers via `new Date(editSession.date)`. Since `editSession.date` is a `"yyyy-MM-dd"` string, JS parses it as **UTC midnight**, which renders as the previous calendar day in any timezone west of UTC (e.g., all of the Americas).

The codebase already has `parseLocalDate` in `src/utils/dateUtils.ts` for exactly this case — it's used everywhere else (SessionSummary, ExerciseDetailModal, CalendarDayDetail, etc.) but was missed here.

### Fix
Use `parseLocalDate` instead of `new Date` when seeding `editDate` and `editTime`.

```ts
// Before
const d = new Date(editSession.date);

// After
const d = parseLocalDate(editSession.date);
```

### Files
- **`src/components/ActiveSession.tsx`** — replace the two `new Date(editSession.date)` calls in the `editDate`/`editTime` `useState` initializers with `parseLocalDate(editSession.date)`. Add `parseLocalDate` to the imports from `@/utils/dateUtils` if not already imported.

### What stays the same
- All other edit logic, save flow, and the `sessionDate = editDate || editSession.date.substring(0, 10)` save path on line 1019 (which is already timezone-safe — it just slices the string).
- No UI/visual changes.
