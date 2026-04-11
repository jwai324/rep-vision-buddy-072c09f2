

## Plan: Show Custom Exercise Names in Template Builder

### Problem
When a custom exercise is added to a template, the `EXERCISES` lookup table (built only from the built-in exercise database) doesn't contain custom exercises. The fallback shows the raw ID (e.g., `custom-abc123`) instead of the exercise name.

### Fix
Two locations in `src/components/TemplateBuilder.tsx` need updating:

1. **Import** `useCustomExercisesContext` and call it in the component to get custom exercises.
2. **Create a merged lookup** that combines `EXERCISES` with custom exercises, so any exercise ID resolves to its proper name.
3. **Use the merged lookup** in both:
   - `exerciseToBlock()` (line 36-48) — move this logic inside the component or pass the lookup to it
   - `addMultipleExercises()` (line 148-163) — where new blocks are created

Similarly, the same fix is needed in `src/components/ActiveSession.tsx` at lines 167, 458, 490, and 555 where `EXERCISES[id]?.name ?? id` is used.

### Files Changed
- `src/components/TemplateBuilder.tsx` — use custom exercises context for name resolution
- `src/components/ActiveSession.tsx` — use custom exercises context for name resolution

