

## Fix: "Every N Days" Start Date Not Used Outside Program Builder

### Root cause
The `startDate` field on the `everyNDays` frequency is only read in `ProgramBuilder.tsx` (calendar preview). Two other places that generate scheduled dates ignore it entirely:

1. **`src/hooks/useStorage.ts`** (future workout generation) — line 39: `let current = new Date(start)` always uses program start date
2. **`src/components/Dashboard.tsx`** (today's workout widget) — line 182: same issue

This causes all "Every N Days" entries to start on the same day (the program start date), regardless of what the user picked.

### Changes

**1. `src/hooks/useStorage.ts`** (~line 38-43)
- Replace `let current = new Date(start)` with:
  ```
  const origin = freq.startDate ? parseLocalDate(freq.startDate) : new Date(start);
  let current = new Date(origin);
  ```
- Add guard: only push events when `current >= start`
- Import `parseLocalDate` from `@/utils/dateUtils`

**2. `src/components/Dashboard.tsx`** (~line 181-186)
- Same fix: use `freq.startDate` as origin when available, fall back to program start
- Add guard: only push events when `current >= start`
- Import `parseLocalDate` from `@/utils/dateUtils`

### What stays the same
- `ProgramBuilder.tsx` — already correct
- Type definitions — `startDate` field already exists on the type
- Draft caching and save logic — unchanged

