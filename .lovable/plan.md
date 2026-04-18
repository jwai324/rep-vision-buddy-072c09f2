
## Fix cardio set completion

### Bug
Cardio exercises store time in `set.time`, but `canCompleteSet` is called with `set.reps` as the time source (`ActiveSession.tsx:755`). Since cardio rows have no reps input, the check always fails and the user can't tick the set complete.

### Fix

**1. `src/utils/setValidation.ts`**
Add an explicit `time` parameter to `canCompleteSet` for cardio mode:
```ts
export function canCompleteSet(
  weight: string, reps: string, unit: WeightUnit,
  isBodyweight = false, isCardio = false, time = '',
): boolean {
  if (isCardio) {
    const t = parseFloat(time);
    return !isNaN(t) && t > 0;
  }
  // ...existing weighted/band logic
}
```

**2. `src/components/ActiveSession.tsx` (line 755)**
Pass `set.time` as the new arg:
```ts
canCompleteSet(set.weight, set.reps, weightUnit, isBodyweight, mode === 'cardio', set.time)
```
Update the toast message for cardio: `"Enter a time before completing this set."` vs the existing weight/reps message.

**3. Tests**
- Update `src/test/setValidation.test.ts` cardio case to use the new `time` argument.
- Update `src/test/integration.test.ts` similarly.

### Files
- Modify: `src/utils/setValidation.ts`, `src/components/ActiveSession.tsx`, `src/test/setValidation.test.ts`, `src/test/integration.test.ts`

### Unchanged
- DB schema, RLS, band/weighted flows, save logic (already reads `set.time` correctly at line 1315).

### Validation
- Start a cardio exercise (e.g. Running), enter only a time, tap ✓ → set completes and rest timer starts.
- Try to complete with empty time → shows "Enter a time…" toast.
- Weighted and band exercises still require weight + reps as before.
