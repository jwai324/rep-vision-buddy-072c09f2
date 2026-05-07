## Problem

The time input for time-based exercises has three issues:
1. **Column header says "Minutes"** but the stored value is total seconds — entering "5" gives 5 seconds, not 5 minutes.
2. **No way to enter a colon** on a numeric keyboard, making the "m:ss" format hard to use.
3. **Single free-text field** with no clear separation between minutes and seconds.

## Plan

### 1. Replace `TimeInputButton` popover with a split M : SS input

**`src/components/ActiveSession.tsx`** — Rewrite the popover content inside `TimeInputButton`:

- Replace the single `<input>` with two side-by-side numeric inputs: one for minutes, one for seconds (0–59).
- Place a permanent `:` separator between them.
- On open: decompose the current total-seconds value into minutes and seconds fields.
- On "Done" / Enter: combine `min * 60 + sec` and call `onChange(String(total))`.
- Tapping the minutes field lets the user type minutes; tapping the seconds field lets them type seconds. Each field auto-selects on focus for quick entry.
- Seconds field is clamped to 0–59 on commit.

### 2. Update column header

**`src/components/ActiveSession.tsx`** — In `SetTableHeader`, change the `'time'` and `'time-distance'` cases:
- Change `"Minutes"` to `"Time (M:SS)"` so it matches the actual format.

### 3. No changes to storage or parsing

The underlying value remains total seconds (string). `formatMmSs` and `parseMmSs` in `timeFormat.ts` stay unchanged — only the UI input changes.
